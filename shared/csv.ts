import Papa from 'papaparse';
import { questionSchema, type Question } from './model';

export const csvHeaders = ['id', 'text', 'answer', 'aliases', 'retryAliases', 'collection', 'majorCategory', 'minorCategory', 'reading', 'category', 'source', 'note'] as const;
const names: Record<string, string> = { '問題ID': 'id', '問題文': 'text', '正解': 'answer', '答え': 'answer', '問題集': 'collection', '大ジャンル': 'majorCategory', '小ジャンル': 'minorCategory', 'もう一回': 'retryAliases', '別解': 'aliases', '読み上げ用': 'reading', '分野': 'category', '出典': 'source', 'メモ': 'note' };

// Scope numbered source rows to their collection; encoding is stable and avoids collisions.
export function collectionId(collection: string, id: string): string {
  return [...collection].map(c => /[\p{L}\p{N}]/u.test(c) ? c : '_' + c.codePointAt(0)!.toString(16) + '_').join('') + '-' + id;
}

export function answerVariants(raw: string): string[] {
  const clean = (s: string) => s.replace(/[『』「」]/g, '').trim();
  const value = clean(raw);
  const values = [value];
  // Japanese parentheses in this source contain readings or annotations, never fuzzy matching rules.
  if (/（[^）]*）/.test(value)) {
    values.push(value.replace(/（[^）]*）/g, ''));
    if ([...value.matchAll(/（([^）]*)）/g)].every(m => /^[ぁ-ゖァ-ヶー・\s]+$/u.test(m[1]))) {
      values.push(value.replace(/([\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9・-]*)（([^）]*)）/gu,
        (whole, name: string, reading: string) => reading.startsWith('・') ? whole : reading.length === 1 ? name + reading : reading.replace(/[・\s]/g, '')));
    }
    for (const match of value.matchAll(/（([A-Z]{2,10})）/g)) values.push(match[1]);
  }
  if (/\(s\)/.test(value)) values.push(value.replace(/\(s\)/g, ''), value.replace(/\(s\)/g, 's'));
  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}

function splitCriteria(value: string): string[] {
  // Separate alternatives only outside parentheses (e.g. kana readings containing 、).
  const parts: string[] = []; let start = 0; let depth = 0;
  for (let i = 0; i < value.length; i++) {
    if ('（('.includes(value[i])) depth++;
    if ('）)'.includes(value[i])) depth--;
    if (depth === 0 && ('、|'.includes(value[i]) || value[i] === ',' && !/(?:Company,|Ethical, Legal)/.test(value))) {
      parts.push(value.slice(start, i)); start = i + 1;
    }
    if (depth === 0 && '』」'.includes(value[i]) && '『「'.includes(value[i + 1] ?? ' ')) {
      parts.push(value.slice(start, i + 1)); start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map(p => p.trim()).filter(Boolean);
}

export function parseCriteria(raw: string): { aliases: string[]; retryAliases: string[]; note: string } {
  const aliases: string[] = [], retryAliases: string[] = [], notes: string[] = [];
  // Some exports contain literal backslash-n; accept those as well as real newlines.
  for (const line of raw.replace(/\\n/g, '\n').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    if (/^[×✕✗]\s*[:：]/.test(line)) continue;
    notes.push(line);
    const reading = line.match(/^読み[:：]\s*(.+)$/);
    if (reading) { aliases.push(reading[1]); continue; }
    const marker = line.match(/^([○〇△]|続行)\s*[:：]\s*(.*)$/);
    if ((!marker && /^(※|読み[:：])/.test(line)) || /[」』]読み$/.test(line)) continue;
    const target = marker?.[1] === '△' || marker?.[1] === '続行' ? retryAliases : aliases;
    let body = marker?.[2] ?? line;
    const readingNote = body.split('※読みは')[1];
    if (readingNote) target.push(...[...readingNote.matchAll(/「([^」]+)」/g)].map(m => m[1]));
    body = body.replace(/^[（(]早[^）)]*[）)]/, '').replace(/\s*※.*$/, '');
    for (const part of splitCriteria(body)) {
      const text = part.replace(/(?:のみ|など|\s+など)$/, '').trim();
      if (!text || /[〜～]/.test(text)) continue;
      target.push(...answerVariants(text));
    }
  }
  return { aliases: [...new Set(aliases)], retryAliases: [...new Set(retryAliases)], note: notes.join('\n') };
}

export function parseQuestionsCsv(csv: string, options: { collection?: string } = {}): { questions: Question[]; errors: string[] } {
  const result = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), {
    header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim() === '' ? 'id' : names[h.trim()] ?? h.trim(),
  });
  const errors = result.errors.map(e => `データ行 ${(e.row ?? 0) + 1}: ${e.message}`);
  for (const required of ['id', 'text', 'answer']) {
    if (!result.meta.fields?.includes(required)) errors.push(`必須の列「${required}」がありません。テンプレートを確認してください。`);
  }
  if (result.data.length > 10000) errors.push('一度に選択できるのは10000問までです。ファイルを分けてください。');
  const seen = new Set<string>();
  const questions: Question[] = [];
  result.data.slice(0, 10000).forEach((row, i) => {
    const collection = row.collection || options.collection || '';
    const criteria = parseCriteria(row['別解・正誤判定基準'] ?? '');
    const annotated = Boolean(result.meta.fields?.includes('別解・正誤判定基準'));
    if (annotated && !collection) errors.push('問題集名を入力してください。番号から固定IDを作成します。');
    const aliases = [...(row.aliases ?? '').split('|').map(a => a.trim()).filter(Boolean), ...criteria.aliases];
    if (annotated) aliases.push(...answerVariants(row.answer ?? ''));
    if (annotated && /※順不同/.test(criteria.note)) {
      for (const value of [row.answer, ...aliases]) {
        const parts = value.split('と');
        if (parts.length === 2) aliases.push(parts.reverse().join('と'));
      }
    }
    const parsed = questionSchema.safeParse({ ...row, collection,
      id: annotated && row.id?.trim() ? collectionId(collection, row.id.trim()) : row.id,
      aliases: [...new Set(aliases)].filter(a => a !== row.answer),
      retryAliases: [...new Set([...(row.retryAliases ?? '').split('|').map(a => a.trim()).filter(Boolean), ...criteria.retryAliases])],
      note: [row.note, criteria.note].filter(Boolean).join('\n'),
    });
    if (!parsed.success) {
      errors.push(`データ行 ${i + 1}: ${parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(' / ')}`);
    } else if (seen.has(parsed.data.id)) {
      errors.push(`データ行 ${i + 1}: ID「${parsed.data.id}」が重複しています。`);
    } else { seen.add(parsed.data.id); questions.push(parsed.data); }
  });
  if (!result.data.length) errors.push('問題がありません。');
  return { questions, errors };
}
export function questionsCsv(questions: Question[]): string {
  return '\uFEFF' + Papa.unparse({ fields: [...csvHeaders], data: questions.map(q => csvHeaders.map(h => h === 'aliases' || h === 'retryAliases' ? q[h].join('|') : q[h])) });
}
export const sampleQuestions: Question[] = [
  { id: 'sample-001', text: '日本で最も高い山は何でしょう？', answer: '富士山', aliases: ['ふじさん', 'フジサン'], reading: '', category: '地理', source: '動作確認用の例題', note: '標高は3,776メートルです。' },
  { id: 'sample-002', text: '小説「吾輩は猫である」の作者は誰でしょう？', answer: '夏目漱石', aliases: ['なつめそうせき'], reading: '小説、わがはいはねこである、の作者は誰でしょう？', category: '文学', source: '動作確認用の例題', note: '' },
  { id: 'sample-003', text: '元素記号がOで表される元素は何でしょう？', answer: '酸素', aliases: ['さんそ'], reading: '元素記号が、オー、で表される元素は何でしょう？', category: '科学', source: '動作確認用の例題', note: '' },
  { id: 'sample-004', text: '1年が366日ある年を、一般に何年というでしょう？', answer: 'うるう年', aliases: ['閏年', 'うるうどし'], reading: '', category: '一般', source: '動作確認用の例題', note: '' },
  { id: 'sample-005', text: 'サッカーで、1チームが試合開始時にフィールドに出せる選手の人数は何人でしょう？', answer: '11人', aliases: ['11', 'じゅういちにん'], reading: '', category: 'スポーツ', source: '動作確認用の例題', note: 'ゴールキーパーを含みます。' },
].map(q => questionSchema.parse(q));
