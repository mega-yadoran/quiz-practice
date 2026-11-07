import { describe, expect, it } from 'vitest';
import { normalizeAnswer, isCorrect, judgeAnswer, questionSchema } from '../shared/model';
import { parseQuestionsCsv, parseCriteria, questionsCsv, sampleQuestions } from '../shared/csv';
import app, { type Bindings } from '../worker';

describe('回答の照合', () => {
  it('全角半角・大文字小文字・前後の空白を吸収する', () => {
    expect(normalizeAnswer('　ＡｂＣ１２３　')).toBe('abc123');
    expect(isCorrect(' １１人 ', { answer: '11人', aliases: [] })).toBe(true);
  });
  it('ひらがなや略称は登録した場合だけ正解にする', () => {
    expect(isCorrect('ふじさん', { answer: '富士山', aliases: [] })).toBe(false);
    expect(isCorrect('ふじさん', { answer: '富士山', aliases: ['ふじさん'] })).toBe(true);
    expect(isCorrect('富士', { answer: '富士山', aliases: [] })).toBe(false);
  });
  it('空白のみの回答、部分一致、内部のスペース違いを通さない', () => {
    expect(isCorrect('　', { answer: '富士山', aliases: [] })).toBe(false);
    expect(isCorrect('NewYork', { answer: 'New York', aliases: [] })).toBe(false);
  });
});
describe('CSV取り込み', () => {
  it('日本語・引用符・カンマ・改行・別解を往復できる', () => {
    const questions = [{ ...sampleQuestions[0], text: '「A,B」と\n"C"の問題', note: '解説\n2行目' }];
    const parsed = parseQuestionsCsv(questionsCsv(questions));
    expect(parsed.errors).toEqual([]);
    expect(parsed.questions).toEqual(questions);
  });
  it('日本語の列名も受け付ける', () => {
    const parsed = parseQuestionsCsv('問題ID,問題文,正解,別解\nq1,山は？,富士山,ふじさん|フジサン');
    expect(parsed.errors).toEqual([]);
    expect(parsed.questions[0].aliases).toEqual(['ふじさん', 'フジサン']);
  });
  it('重複ID・空の正解・列不足・10000問超過を拒否する', () => {
    expect(parseQuestionsCsv('id,text,answer\nq1,a,b\nq1,c,d').errors.join()).toContain('重複');
    expect(parseQuestionsCsv('id,text,answer\nq1,a,').errors.length).toBeGreaterThan(0);
    expect(parseQuestionsCsv('id,text\nq1,a').errors.join()).toContain('必須の列');
    expect(parseQuestionsCsv('id,text,answer\n' + Array.from({ length: 10001 }, (_, i) => `q${i},a,b`).join('\n')).errors.join()).toContain('10000問');
  });
  it('HTMLなどをIDとして使わない', () => {
    expect(questionSchema.safeParse({ ...sampleQuestions[0], id: '<script>' }).success).toBe(false);
  });
});
describe('公開時のアクセス制御', () => {
  it('未設定の公開環境では画面もAPIも閉じる', async () => {
    const env = { ENVIRONMENT: 'production', OWNER_EMAIL: 'owner@example.com' } as Bindings;
    expect((await app.request('https://quiz.example.com/', {}, env)).status).toBe(503);
    expect((await app.request('https://quiz.example.com/api/me', {}, env)).status).toBe(503);
  });
  it('設定があってもAccessの署名済みトークンがない要求を拒否する', async () => {
    const env = { ENVIRONMENT: 'production', OWNER_EMAIL: 'owner@example.com', ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'test' } as Bindings;
    expect((await app.request('https://quiz.example.com/api/me', {}, env)).status).toBe(401);
  });
  it('local設定を誤って公開しても外部ホストでは認証を省略しない', async () => {
    const env = { ENVIRONMENT: 'local', OWNER_EMAIL: 'owner@example.com' } as Bindings;
    expect((await app.request('https://quiz.example.com/api/me', {}, env)).status).toBe(503);
    expect((await app.request('http://127.0.0.1/api/me', {}, env)).status).toBe(200);
  });
  it('外部サイトからの更新要求とフォーム投稿を拒否する', async () => {
    const env = { ENVIRONMENT: 'local', OWNER_EMAIL: 'owner@example.com' } as Bindings;
    expect((await app.request('http://127.0.0.1/api/import', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '[]' }, env)).status).toBe(403);
    expect((await app.request('http://127.0.0.1/api/import', { method: 'POST', body: 'x=y' }, env)).status).toBe(415);
  });
});

describe('問題集・ジャンル・再回答のCSV', () => {
  it('800問を番号と問題集名で識別し、別の問題集と衝突させない', () => {
    const csv = ',大ジャンル,小ジャンル,問題文,答え,別解・正誤判定基準\n' + Array.from({ length: 800 }, (_, i) => (i + 1) + ',科学,単位,単位は？,カンデラ,△：cd').join('\n');
    const parsed = parseQuestionsCsv(csv, { collection: 'abc本戦' });
    expect(parsed.errors).toEqual([]);
    expect(parsed.questions).toHaveLength(800);
    expect(parsed.questions[0]).toMatchObject({ id: 'abc本戦-1', collection: 'abc本戦', majorCategory: '科学', minorCategory: '単位', retryAliases: ['cd'] });
    expect(parseQuestionsCsv(csv, { collection: '別問題集' }).questions[0].id).not.toBe(parsed.questions[0].id);
    expect(parseQuestionsCsv(csv).errors.length).toBeGreaterThan(0);
  });
  it('○・△・英語表記を分離し、×をメモにも保存しない', () => {
    const parsed = parseCriteria('candela\\n○：カンデラ単位\n△：（早く押して）cd、シーディー\n×：ルクス');
    expect(parsed.aliases).toEqual(['candela', 'カンデラ単位']);
    expect(parsed.retryAliases).toEqual(['cd', 'シーディー']);
    expect(parsed.note).not.toContain('ルクス');
    expect(parseCriteria('△：『大魔界村』『超魔界村』').retryAliases).toEqual(['大魔界村', '超魔界村']);
    expect(parseCriteria('△：(COOH)2').retryAliases).toEqual(['(COOH)2']);
  });
  it('読み・作品名の表記を別解にし、新しい列を往復できる', () => {
    const parsed = parseQuestionsCsv(',問題文,答え,別解・正誤判定基準\n1,誰？,夏目漱石（なつめ・そうせき）,○：漱石', { collection: '本' });
    expect(parsed.questions[0].aliases).toContain('夏目漱石');
    expect(parsed.questions[0].aliases).toContain('なつめそうせき');
    expect(parseQuestionsCsv(questionsCsv(parsed.questions)).questions).toEqual(parsed.questions);
  });
  it('登録した△だけを再回答にし、正解を優先する', () => {
    const q = { answer: 'カンデラ', aliases: ['candela'], retryAliases: ['cd', 'candela'] };
    expect(judgeAnswer('ＣＤ', q)).toBe('retry');
    expect(judgeAnswer('candela', q)).toBe('correct');
    expect(judgeAnswer('ルクス', q)).toBe('incorrect');
    expect(judgeAnswer('', q)).toBe('incorrect');
  });
});

 it('nested pages and single-question API require authentication', async () => {
  const env = { ENVIRONMENT: 'production', OWNER_EMAIL: 'owner@example.com', ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'test' } as Bindings;
  for (const path of ['/practice', '/questions/new', '/questions/test/edit', '/questions/import', '/questions/collections', '/favorites/test/edit', '/api/questions/test']) expect((await app.request('https://quiz.example.com' + path, {}, env)).status).toBe(401);
});
