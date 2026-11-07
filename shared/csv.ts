import Papa from 'papaparse';
import { questionSchema, type Question } from './model';

export const csvHeaders = ['id', 'text', 'answer', 'aliases', 'reading', 'category', 'source', 'note'] as const;
const names: Record<string, string> = { '問題ID': 'id', '問題文': 'text', '正解': 'answer', '別解': 'aliases', '読み上げ用': 'reading', '分野': 'category', '出典': 'source', 'メモ': 'note' };
export function parseQuestionsCsv(csv: string): { questions: Question[]; errors: string[] } {
  const result = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), {
    header: true, skipEmptyLines: 'greedy', transformHeader: h => names[h.trim()] ?? h.trim(),
  });
  const errors = result.errors.map(e => `データ行 ${(e.row ?? 0) + 1}: ${e.message}`);
  for (const required of ['id', 'text', 'answer']) {
    if (!result.meta.fields?.includes(required)) errors.push(`必須の列「${required}」がありません。テンプレートを確認してください。`);
  }
  if (result.data.length > 500) errors.push('一度に取り込めるのは500問までです。ファイルを分けてください。');
  const seen = new Set<string>();
  const questions: Question[] = [];
  result.data.slice(0, 500).forEach((row, i) => {
    const parsed = questionSchema.safeParse({ ...row, aliases: (row.aliases ?? '').split('|').map(a => a.trim()).filter(Boolean) });
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
  return '\uFEFF' + Papa.unparse({ fields: [...csvHeaders], data: questions.map(q => csvHeaders.map(h => h === 'aliases' ? q.aliases.join('|') : q[h])) });
}
export const sampleQuestions: Question[] = [
  { id: 'sample-001', text: '日本で最も高い山は何でしょう？', answer: '富士山', aliases: ['ふじさん', 'フジサン'], reading: '', category: '地理', source: '動作確認用の例題', note: '標高は3,776メートルです。' },
  { id: 'sample-002', text: '小説「吾輩は猫である」の作者は誰でしょう？', answer: '夏目漱石', aliases: ['なつめそうせき'], reading: '小説、わがはいはねこである、の作者は誰でしょう？', category: '文学', source: '動作確認用の例題', note: '' },
  { id: 'sample-003', text: '元素記号がOで表される元素は何でしょう？', answer: '酸素', aliases: ['さんそ'], reading: '元素記号が、オー、で表される元素は何でしょう？', category: '科学', source: '動作確認用の例題', note: '' },
  { id: 'sample-004', text: '1年が366日ある年を、一般に何年というでしょう？', answer: 'うるう年', aliases: ['閏年', 'うるうどし'], reading: '', category: '一般', source: '動作確認用の例題', note: '' },
  { id: 'sample-005', text: 'サッカーで、1チームが試合開始時にフィールドに出せる選手の人数は何人でしょう？', answer: '11人', aliases: ['11', 'じゅういちにん'], reading: '', category: 'スポーツ', source: '動作確認用の例題', note: 'ゴールキーパーを含みます。' },
];
