import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { isCorrect, questionSchema, type PracticeState, type Question } from '../shared/model';

export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  OWNER_EMAIL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}
type Env = { Bindings: Bindings; Variables: { email: string } };
type DbQuestion = Omit<Question, 'aliases'> & { aliases: string; favorite: number };
type DbAttempt = {
  id: string; round_id: number; question_id: string; question_text: string; reading: string;
  answer: string; aliases: string; category: string; note: string; source: string;
  submitted_answer: string | null; correct: number | null; overridden: number; skipped: number;
  issued_at: string; answered_at: string | null; favorite: number;
};
const app = new Hono<Env>();
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Cache-Control', 'no-store');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const hostname = new URL(c.req.url).hostname;
  const local = c.env.ENVIRONMENT === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (local) {
    c.set('email', c.env.OWNER_EMAIL);
  } else {
    if (!c.env.ACCESS_TEAM_DOMAIN || !c.env.ACCESS_AUD || !c.env.OWNER_EMAIL) {
      return c.text('公開前の設定が必要です。Cloudflare Accessの設定を確認してください。', 503);
    }
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) return c.text('ログインが必要です。Cloudflare Accessからアクセスしてください。', 401);
    try {
      const issuer = `https://${c.env.ACCESS_TEAM_DOMAIN}`;
      let jwks = keySets.get(issuer);
      if (!jwks) { jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); keySets.set(issuer, jwks); }
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: c.env.ACCESS_AUD, algorithms: ['RS256'] });
      if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== c.env.OWNER_EMAIL.toLowerCase()) return c.text('このアカウントでは利用できません。', 403);
      c.set('email', payload.email);
    } catch { return c.text('ログインの有効期限が切れています。ページを開き直してください。', 401); }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'アクセス元を確認できません。' }, 403);
    if (!c.req.header('Content-Type')?.startsWith('application/json')) return c.json({ error: 'JSON形式で送信してください。' }, 415);
  }
  await next();
});
app.use('/api/*', bodyLimit({ maxSize: 4 * 1024 * 1024, onError: c => c.json({ error: 'データが大きすぎます。ファイルを分けてください。' }, 413) }));
app.onError((err, c) => {
  if (err instanceof z.ZodError) return c.json({ error: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' / ') }, 400);
  if (err instanceof SyntaxError) return c.json({ error: 'データの形式を確認してください。' }, 400);
  console.error('Request failed:', err.message);
  return c.json({ error: '処理に失敗しました。しばらくしてから再度お試しください。' }, 500);
});
app.get('/api/me', c => c.json({ email: c.get('email'), local: c.env.ENVIRONMENT === 'local' }));

function decodeQuestion(row: DbQuestion) { return { ...row, aliases: JSON.parse(row.aliases), favorite: Boolean(row.favorite) }; }
function upsertQuestion(db: D1Database, q: Question) {
  return db.prepare(`INSERT INTO questions(id,text,answer,aliases,reading,category,source,note,random_key)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,answer=excluded.answer,
    aliases=excluded.aliases,reading=excluded.reading,category=excluded.category,source=excluded.source,
    note=excluded.note,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .bind(q.id, q.text, q.answer, JSON.stringify(q.aliases), q.reading, q.category, q.source, q.note, Math.random());
}
app.get('/api/stats', async c => {
  const result = await c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM questions) total,
    (SELECT COUNT(*) FROM favorites) favorites,
    COUNT(CASE WHEN skipped=0 THEN 1 END) answered,
    COALESCE(SUM(CASE WHEN skipped=0 THEN correct ELSE 0 END),0) correct,
    COUNT(CASE WHEN date(answered_at,'+9 hours')=date('now','+9 hours') AND skipped=0 THEN 1 END) today,
    COALESCE(SUM(skipped),0) skipped FROM attempts WHERE answered_at IS NOT NULL`).first();
  return c.json(result);
});
app.get('/api/questions', async c => {
  const page = Math.max(1, Math.min(1000000, Number(c.req.query('page')) || 1));
  const search = (c.req.query('search') ?? '').slice(0, 100);
  const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const favorite = c.req.query('favorite') === '1';
  const where = `WHERE (q.text LIKE ? ESCAPE '\\' OR q.answer LIKE ? ESCAPE '\\' OR q.category LIKE ? ESCAPE '\\' OR q.id LIKE ? ESCAPE '\\') ${favorite ? 'AND f.question_id IS NOT NULL' : ''}`;
  const [rows, count] = await Promise.all([
    c.env.DB.prepare(`SELECT q.*,f.question_id IS NOT NULL favorite FROM questions q LEFT JOIN favorites f ON f.question_id=q.id ${where} ORDER BY q.created_at DESC,q.id LIMIT 20 OFFSET ?`).bind(like, like, like, like, (page - 1) * 20).all<DbQuestion>(),
    c.env.DB.prepare(`SELECT COUNT(*) total FROM questions q LEFT JOIN favorites f ON f.question_id=q.id ${where}`).bind(like, like, like, like).first<{ total: number }>(),
  ]);
  return c.json({ questions: rows.results.map(decodeQuestion), total: count?.total ?? 0, page, pageSize: 20 });
});
app.post('/api/questions', async c => {
  const q = questionSchema.parse(await c.req.json());
  const result = await c.env.DB.prepare(`INSERT OR IGNORE INTO questions(id,text,answer,aliases,reading,category,source,note,random_key) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(q.id, q.text, q.answer, JSON.stringify(q.aliases), q.reading, q.category, q.source, q.note, Math.random()).run();
  if (!result.meta.changes) return c.json({ error: '同じIDの問題があります。既存の問題を編集するか、別のIDを指定してください。' }, 409);
  return c.json({ ok: true }, 201);
});
app.put('/api/questions/:id', async c => {
  const q = questionSchema.parse({ ...await c.req.json(), id: c.req.param('id') });
  const exists = await c.env.DB.prepare('SELECT id FROM questions WHERE id=?').bind(q.id).first();
  if (!exists) return c.json({ error: '問題が見つかりません。' }, 404);
  await upsertQuestion(c.env.DB, q).run();
  return c.json({ ok: true });
});
app.post('/api/import/preview', async c => {
  const questions = z.array(questionSchema).min(1).max(500).parse(await c.req.json());
  if (new Set(questions.map(q => q.id)).size !== questions.length) return c.json({ error: '問題IDが重複しています。' }, 400);
  const existing: string[] = [];
  for (let i = 0; i < questions.length; i += 80) {
    const ids = questions.slice(i, i + 80).map(q => q.id);
    const rows = await c.env.DB.prepare(`SELECT id FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string }>();
    existing.push(...rows.results.map(q => q.id));
  }
  return c.json({ existing, added: questions.length - existing.length, updated: existing.length });
});
app.post('/api/import', async c => {
  const questions = z.array(questionSchema).min(1).max(500).parse(await c.req.json());
  if (new Set(questions.map(q => q.id)).size !== questions.length) return c.json({ error: '問題IDが重複しています。' }, 400);
  await c.env.DB.batch(questions.map(q => upsertQuestion(c.env.DB, q)));
  return c.json({ ok: true, count: questions.length });
});
app.put('/api/favorites/:id', async c => {
  const { favorite } = z.object({ favorite: z.boolean() }).parse(await c.req.json());
  const id = c.req.param('id');
  if (!await c.env.DB.prepare('SELECT id FROM questions WHERE id=?').bind(id).first()) return c.json({ error: '問題が見つかりません。' }, 404);
  if (favorite) await c.env.DB.prepare('INSERT OR IGNORE INTO favorites(question_id) VALUES(?)').bind(id).run();
  else await c.env.DB.prepare('DELETE FROM favorites WHERE question_id=?').bind(id).run();
  return c.json({ ok: true });
});

async function getPractice(db: D1Database): Promise<PracticeState> {
  const round = await db.prepare('SELECT id FROM rounds ORDER BY id DESC LIMIT 1').first<{ id: number }>();
  const count = await db.prepare('SELECT COUNT(*) total FROM questions').first<{ total: number }>();
  const total = count?.total ?? 0;
  if (!round) return { round: 0, total, seen: 0, attempt: null, completed: false };
  const row = await db.prepare(`SELECT a.*,f.question_id IS NOT NULL favorite FROM attempts a LEFT JOIN favorites f ON f.question_id=a.question_id WHERE a.round_id=? ORDER BY a.rowid DESC LIMIT 1`).bind(round.id).first<DbAttempt>();
  const seen = await db.prepare('SELECT COUNT(*) count FROM attempts WHERE round_id=?').bind(round.id).first<{ count: number }>();
  const remaining = await db.prepare('SELECT EXISTS(SELECT 1 FROM questions q WHERE NOT EXISTS(SELECT 1 FROM attempts a WHERE a.round_id=? AND a.question_id=q.id)) remaining').bind(round.id).first<{ remaining: number }>();
  const state: PracticeState = { round: round.id, total, seen: seen?.count ?? 0, completed: !remaining?.remaining && (!row || row.answered_at !== null), attempt: null };
  if (row) state.attempt = {
    id: row.id, questionId: row.question_id, text: row.question_text, reading: row.reading,
    category: row.category, favorite: Boolean(row.favorite), answered: row.answered_at !== null,
    ...(row.answered_at !== null ? { answer: row.answer, aliases: JSON.parse(row.aliases), note: row.note, source: row.source, submittedAnswer: row.submitted_answer ?? '', correct: Boolean(row.correct), overridden: Boolean(row.overridden), skipped: Boolean(row.skipped) } : {}),
  };
  return state;
}
app.get('/api/practice', async c => c.json(await getPractice(c.env.DB)));
app.post('/api/practice/next', async c => {
  const { newRound } = z.object({ newRound: z.boolean().default(false) }).parse(await c.req.json());
  const db = c.env.DB;
  const state = await getPractice(db);
  if (!state.total || (state.attempt && !state.attempt.answered)) return c.json(state);
  if (state.completed && !newRound) return c.json(state);
  // Conditional insert prevents simultaneous devices from creating duplicate rounds.
  await db.prepare(`INSERT INTO rounds(start_key) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM rounds)
    OR NOT EXISTS(SELECT 1 FROM questions q WHERE NOT EXISTS(SELECT 1 FROM attempts a WHERE a.round_id=(SELECT MAX(id) FROM rounds) AND a.question_id=q.id))`)
    .bind(Math.random()).run();
  const round = await db.prepare('SELECT * FROM rounds ORDER BY id DESC LIMIT 1').first<{ id: number; start_key: number }>();
  if (!round) return c.json(await getPractice(db));
  // Two indexed ranges pick an unseen question without ORDER BY RANDOM() over the whole bank.
  const select = `SELECT q.* FROM questions q WHERE q.random_key %COMPARE% ? AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.round_id=? AND a.question_id=q.id) ORDER BY q.random_key,q.id LIMIT 1`;
  const q = await db.prepare(select.replace('%COMPARE%', '>=' )).bind(round.start_key, round.id).first<DbQuestion>()
    ?? await db.prepare(select.replace('%COMPARE%', '<')).bind(round.start_key, round.id).first<DbQuestion>();
  if (q) await db.prepare(`INSERT OR IGNORE INTO attempts(id,round_id,question_id,question_text,reading,answer,aliases,category,note,source) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), round.id, q.id, q.text, q.reading, q.answer, q.aliases, q.category, q.note, q.source).run();
  return c.json(await getPractice(db));
});
app.post('/api/attempts/:id/answer', async c => {
  const { answer, skip } = z.object({ answer: z.string().trim().max(500).default(''), skip: z.boolean().default(false) }).parse(await c.req.json());
  if (!skip && !answer) return c.json({ error: '答えを入力してください。' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM attempts WHERE id=?').bind(c.req.param('id')).first<DbAttempt>();
  if (!row) return c.json({ error: '解答中の問題が見つかりません。' }, 404);
  const correct = !skip && isCorrect(answer, { answer: row.answer, aliases: JSON.parse(row.aliases) });
  await c.env.DB.prepare(`UPDATE attempts SET submitted_answer=?,correct=?,skipped=?,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND answered_at IS NULL`)
    .bind(answer, correct ? 1 : 0, skip ? 1 : 0, row.id).run();
  return c.json(await getPractice(c.env.DB));
});
app.post('/api/attempts/:id/override', async c => {
  await c.env.DB.prepare('UPDATE attempts SET correct=1,overridden=1 WHERE id=? AND answered_at IS NOT NULL AND skipped=0 AND correct=0').bind(c.req.param('id')).run();
  return c.json(await getPractice(c.env.DB));
});
app.get('/api/history', async c => {
  const page = Math.max(1, Math.min(1000000, Number(c.req.query('page')) || 1));
  const [rows, total] = await Promise.all([
    c.env.DB.prepare(`SELECT id,question_id,question_text,answer,submitted_answer,correct,overridden,skipped,answered_at FROM attempts WHERE answered_at IS NOT NULL ORDER BY answered_at DESC,rowid DESC LIMIT 20 OFFSET ?`).bind((page - 1) * 20).all(),
    c.env.DB.prepare('SELECT COUNT(*) total FROM attempts WHERE answered_at IS NOT NULL').first<{ total: number }>(),
  ]);
  return c.json({ history: rows.results, total: total?.total ?? 0, page });
});
app.get('/api/settings', async c => {
  const row = await c.env.DB.prepare('SELECT * FROM settings WHERE id=1').first<{ rate: number; show_question: number }>();
  return c.json({ rate: row?.rate ?? 1, showQuestion: Boolean(row?.show_question) });
});
app.put('/api/settings', async c => {
  const s = z.object({ rate: z.number().min(0.5).max(2), showQuestion: z.boolean() }).parse(await c.req.json());
  await c.env.DB.prepare('UPDATE settings SET rate=?,show_question=? WHERE id=1').bind(s.rate, s.showQuestion ? 1 : 0).run();
  return c.json(s);
});
app.get('/api/export', async c => {
  const results = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare('SELECT * FROM questions ORDER BY id'),
    c.env.DB.prepare('SELECT * FROM favorites'),
    c.env.DB.prepare('SELECT * FROM rounds'),
    c.env.DB.prepare('SELECT * FROM attempts ORDER BY rowid'),
    c.env.DB.prepare('SELECT * FROM settings'),
  ]);
  return c.json({ version: 1, exportedAt: new Date().toISOString(), questions: results[0].results.map(row => ({ ...row, aliases: JSON.parse(row.aliases as string) })), favorites: results[1].results, rounds: results[2].results, attempts: results[3].results, settings: results[4].results });
});
app.all('/api/*', c => c.json({ error: '指定された操作が見つかりません。' }, 404));
app.get('*', c => c.env.ASSETS.fetch(c.req.raw));
export default app;
