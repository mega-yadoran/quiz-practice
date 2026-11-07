import { describe, expect, it } from 'vitest';
import { normalizeAnswer, isCorrect, questionSchema } from '../shared/model';
import { parseQuestionsCsv, questionsCsv, sampleQuestions } from '../shared/csv';
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
  it('重複ID・空の正解・列不足・500問超過を拒否する', () => {
    expect(parseQuestionsCsv('id,text,answer\nq1,a,b\nq1,c,d').errors.join()).toContain('重複');
    expect(parseQuestionsCsv('id,text,answer\nq1,a,').errors.length).toBeGreaterThan(0);
    expect(parseQuestionsCsv('id,text\nq1,a').errors.join()).toContain('必須の列');
    expect(parseQuestionsCsv('id,text,answer\n' + Array.from({ length: 501 }, (_, i) => `q${i},a,b`).join('\n')).errors.join()).toContain('500問');
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
