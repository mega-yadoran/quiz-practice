import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { judgeAnswer, questionSchema, type PracticeState, type Question } from '../shared/model';
import { collectionNameSchema, renameCollectionSchema, deleteCollectionSchema } from '../shared/collections';
import { speechRequestSchema } from '../shared/speech';
import { practiceScopeSchema, practiceNextSchema } from '../shared/practice';
import { visibilitySchema } from '../shared/visibility';
import { SpeechError, synthesize } from './speech';

export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  OWNER_EMAIL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  TTS_PROVIDER?: string;
  GOOGLE_TTS_API_KEY?: string;
  GOOGLE_TTS_VOICE?: string;
}
type Env = { Bindings: Bindings; Variables: { email: string } };
type DbQuestion = Omit<Question, 'aliases' | 'retryAliases'> & { aliases: string; retryAliases: string; favorite: number; hidden: number };
type DbAttempt = {
  id: string; round_id: number; question_id: string; question_text: string; reading: string;
  answer: string; aliases: string; retryAliases: string; collection: string; majorCategory: string; minorCategory: string; retry_requested: number; category: string; note: string; source: string;
  submitted_answer: string | null; correct: number | null; overridden: number; skipped: number;
  cancelled: number; issued_at: string; answered_at: string | null; favorite: number; hidden: number;
};
const app = new Hono<Env>();
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Cache-Control', 'no-store');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
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

app.get('/api/speech/config', c => c.json({
  provider: c.env.TTS_PROVIDER === 'google' ? 'google' : 'browser',
  configured: Boolean(c.env.GOOGLE_TTS_API_KEY),
  voice: c.env.GOOGLE_TTS_VOICE || 'ja-JP-Standard-D',
}));
app.post('/api/speech', async c => {
  if (c.env.TTS_PROVIDER !== 'google') return c.json({ error: 'Google音声は有効になっていません。' }, 503);
  const { attemptId } = speechRequestSchema.parse(await c.req.json());
  const attempt = await c.env.DB.prepare('SELECT a.question_text,a.reading FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.id=? AND a.cancelled=0 AND q.deleted_at IS NULL').bind(attemptId).first<{ question_text: string; reading: string }>();
  if (!attempt) return c.json({ error: '出題が見つかりません。' }, 404);
  try {
    const audio = await synthesize(attempt.reading || attempt.question_text, c.env.GOOGLE_TTS_API_KEY || '', c.env.GOOGLE_TTS_VOICE || 'ja-JP-Standard-D');
    return new Response(audio, { headers: { ...Object.fromEntries(c.res.headers), 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SpeechError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});

function decodeQuestion(row: DbQuestion) { return { ...row, aliases: JSON.parse(row.aliases), retryAliases: JSON.parse(row.retryAliases), favorite: Boolean(row.favorite), hidden: Boolean(row.hidden) }; }
function ensureCollection(db: D1Database, name: string) {
  return db.prepare('INSERT OR IGNORE INTO question_sets(name) VALUES(?)').bind(name);
}
function upsertQuestion(db: D1Database, q: Question) {
  return db.prepare(`INSERT INTO questions(id,text,answer,aliases,reading,category,source,note,random_key,collection,majorCategory,minorCategory,retryAliases)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,answer=excluded.answer,
    aliases=excluded.aliases,reading=excluded.reading,category=excluded.category,source=excluded.source,
    collection=excluded.collection,majorCategory=excluded.majorCategory,minorCategory=excluded.minorCategory,retryAliases=excluded.retryAliases,note=excluded.note,deleted_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .bind(q.id, q.text, q.answer, JSON.stringify(q.aliases), q.reading, q.category, q.source, q.note, Math.random(), q.collection, q.majorCategory, q.minorCategory, JSON.stringify(q.retryAliases));
}
app.get('/api/collections', async c => {
  const rows = await c.env.DB.prepare('SELECT s.name,COUNT(q.id) total FROM question_sets s LEFT JOIN questions q ON q.collection=s.name AND q.deleted_at IS NULL GROUP BY s.name ORDER BY s.name').all();
  return c.json({ collections: rows.results });
});
app.post('/api/collections', async c => {
  const { name } = z.object({ name: collectionNameSchema }).parse(await c.req.json());
  await ensureCollection(c.env.DB, name).run();
  return c.json({ ok: true }, 201);
});

app.put('/api/collections', async c => {
  const { name, newName } = renameCollectionSchema.parse(await c.req.json());
  if (!await c.env.DB.prepare('SELECT name FROM question_sets WHERE name=?').bind(name).first()) return c.json({ error: '問題集が見つかりません。' }, 404);
  if (name === newName) return c.json({ ok: true });
  if (await c.env.DB.prepare('SELECT name FROM question_sets WHERE name=?').bind(newName).first()) return c.json({ error: '同じ名前の問題集があります。別の名前を指定してください。' }, 409);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE question_sets SET name=? WHERE name=?').bind(newName, name),
      c.env.DB.prepare("UPDATE questions SET collection=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE collection=? AND deleted_at IS NULL").bind(newName, name),
      c.env.DB.prepare('UPDATE rounds SET collection=? WHERE collection=?').bind(newName, name),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed: question_sets.name')) return c.json({ error: '同じ名前の問題集があります。' }, 409);
    throw error;
  }
  return c.json({ ok: true });
});
app.get('/api/collections/export', async c => {
  const name = collectionNameSchema.parse(c.req.query('name'));
  if (!await c.env.DB.prepare('SELECT name FROM question_sets WHERE name=?').bind(name).first()) return c.json({ error: '問題集が見つかりません。' }, 404);
  const rows = await c.env.DB.prepare('SELECT q.*,0 favorite FROM questions q WHERE collection=? AND deleted_at IS NULL ORDER BY id').bind(name).all<DbQuestion>();
  return c.json({ questions: rows.results.map(decodeQuestion) });
});
app.delete('/api/collections', async c => {
  const { name, total } = deleteCollectionSchema.parse(await c.req.json());
  if (!await c.env.DB.prepare('SELECT name FROM question_sets WHERE name=?').bind(name).first()) return c.json({ error: '問題集が見つかりません。' }, 404);
  const count = await c.env.DB.prepare('SELECT COUNT(*) total FROM questions WHERE collection=? AND deleted_at IS NULL').bind(name).first<{ total: number }>();
  if (count?.total !== total) return c.json({ error: '問題数が変わりました。管理画面を読み直して確認してください。' }, 409);
  // Each statement checks the count inside the same transaction, so a concurrent import cannot widen the deletion.
  const unchanged = '(SELECT COUNT(*) FROM questions WHERE collection=? AND deleted_at IS NULL)=?';
  const result = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM favorites WHERE question_id IN (SELECT id FROM questions WHERE collection=? AND deleted_at IS NULL) AND ' + unchanged).bind(name, name, total),
    c.env.DB.prepare("UPDATE attempts SET cancelled=1,skipped=1,retry_requested=0,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE answered_at IS NULL AND question_id IN (SELECT id FROM questions WHERE collection=? AND deleted_at IS NULL) AND " + unchanged).bind(name, name, total),
    c.env.DB.prepare("UPDATE questions SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE collection=? AND deleted_at IS NULL AND " + unchanged).bind(name, name, total),
    c.env.DB.prepare('DELETE FROM question_sets WHERE name=? AND NOT EXISTS(SELECT 1 FROM questions WHERE collection=? AND deleted_at IS NULL) AND (?=0 OR changes()=?)').bind(name, name, total, total),
  ]);
  if (!result[3].meta.changes) return c.json({ error: '問題集の内容が変わりました。管理画面を読み直してください。' }, 409);
  return c.json({ ok: true, count: total });
});

app.get('/api/stats', async c => {
  const result = await c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM questions WHERE deleted_at IS NULL) total,
    (SELECT COUNT(*) FROM favorites) favorites,
    COUNT(CASE WHEN skipped=0 THEN 1 END) answered,
    COALESCE(SUM(CASE WHEN skipped=0 THEN correct ELSE 0 END),0) correct,
    COUNT(CASE WHEN date(answered_at,'+9 hours')=date('now','+9 hours') AND skipped=0 THEN 1 END) today,
    COALESCE(SUM(skipped),0) skipped FROM attempts WHERE answered_at IS NOT NULL AND cancelled=0`).first();
  return c.json(result);
});
app.get('/api/questions', async c => {
  const page = Math.max(1, Math.min(1000000, Number(c.req.query('page')) || 1));
  const search = (c.req.query('search') ?? '').slice(0, 100);
  const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const favorite = c.req.query('favorite') === '1';
  const collection = c.req.query('collection');
  const where = `WHERE q.deleted_at IS NULL AND (? IS NULL OR q.collection=?) AND (q.text LIKE ? ESCAPE '\\' OR q.answer LIKE ? ESCAPE '\\' OR q.category LIKE ? ESCAPE '\\' OR q.majorCategory LIKE ? ESCAPE '\\' OR q.minorCategory LIKE ? ESCAPE '\\' OR q.id LIKE ? ESCAPE '\\') ${favorite ? 'AND f.question_id IS NOT NULL' : ''}`;
  const [rows, count] = await Promise.all([
    c.env.DB.prepare(`SELECT q.*,f.question_id IS NOT NULL favorite FROM questions q LEFT JOIN favorites f ON f.question_id=q.id ${where} ORDER BY q.created_at DESC,q.id LIMIT 20 OFFSET ?`).bind(collection ?? null, collection ?? null, like, like, like, like, like, like, (page - 1) * 20).all<DbQuestion>(),
    c.env.DB.prepare(`SELECT COUNT(*) total FROM questions q LEFT JOIN favorites f ON f.question_id=q.id ${where}`).bind(collection ?? null, collection ?? null, like, like, like, like, like, like).first<{ total: number }>(),
  ]);
  return c.json({ questions: rows.results.map(decodeQuestion), total: count?.total ?? 0, page, pageSize: 20 });
});
app.get('/api/questions/:id', async c => {
  const row = await c.env.DB.prepare('SELECT * FROM questions WHERE id=? AND deleted_at IS NULL').bind(c.req.param('id')).first<DbQuestion>();
  if (!row) return c.json({ error: '問題が見つかりません。' }, 404);
  return c.json(decodeQuestion(row));
});
app.post('/api/questions', async c => {
  const q = questionSchema.parse(await c.req.json());
  const results = await c.env.DB.batch([ensureCollection(c.env.DB, q.collection), c.env.DB.prepare(`INSERT OR IGNORE INTO questions(id,text,answer,aliases,reading,category,source,note,random_key,collection,majorCategory,minorCategory,retryAliases) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(q.id, q.text, q.answer, JSON.stringify(q.aliases), q.reading, q.category, q.source, q.note, Math.random(), q.collection, q.majorCategory, q.minorCategory, JSON.stringify(q.retryAliases))]);
  if (!results[1].meta.changes) return c.json({ error: '同じIDの問題があります。既存の問題を編集するか、別のIDを指定してください。' }, 409);
  return c.json({ ok: true }, 201);
});
app.put('/api/questions/:id', async c => {
  const q = questionSchema.parse({ ...await c.req.json(), id: c.req.param('id') });
  const exists = await c.env.DB.prepare('SELECT id FROM questions WHERE id=? AND deleted_at IS NULL').bind(q.id).first();
  if (!exists) return c.json({ error: '問題が見つかりません。' }, 404);
  await c.env.DB.batch([ensureCollection(c.env.DB, q.collection), upsertQuestion(c.env.DB, q)]);
  return c.json({ ok: true });
});
app.put('/api/questions/:id/visibility', async c => {
  const { hidden } = visibilitySchema.parse(await c.req.json());
  const result = await c.env.DB.prepare("UPDATE questions SET hidden=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND deleted_at IS NULL")
    .bind(hidden ? 1 : 0, c.req.param('id')).run();
  if (!result.meta.changes) return c.json({ error: '問題が見つかりません。' }, 404);
  return c.json({ hidden });
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
  await c.env.DB.batch([...new Set(questions.map(q => q.collection))].map(name => ensureCollection(c.env.DB, name)).concat(questions.map(q => upsertQuestion(c.env.DB, q))));
  return c.json({ ok: true, count: questions.length });
});
app.put('/api/favorites/:id', async c => {
  const { favorite } = z.object({ favorite: z.boolean() }).parse(await c.req.json());
  const id = c.req.param('id');
  if (!await c.env.DB.prepare('SELECT id FROM questions WHERE id=? AND deleted_at IS NULL').bind(id).first()) return c.json({ error: '問題が見つかりません。' }, 404);
  if (favorite) await c.env.DB.prepare('INSERT OR IGNORE INTO favorites(question_id) SELECT id FROM questions WHERE id=? AND deleted_at IS NULL').bind(id).run();
  else await c.env.DB.prepare('DELETE FROM favorites WHERE question_id=?').bind(id).run();
  return c.json({ ok: true });
});

async function getPractice(db: D1Database, collection: string | null = null): Promise<PracticeState> {
  const round = await db.prepare('SELECT id,number FROM rounds WHERE collection IS ? AND invalidated=0 ORDER BY id DESC LIMIT 1').bind(collection).first<{ id: number; number: number }>();
  const count = await db.prepare('SELECT COUNT(*) total FROM questions WHERE deleted_at IS NULL AND hidden=0 AND (? IS NULL OR collection=?)').bind(collection, collection).first<{ total: number }>();
  const total = count?.total ?? 0;
  if (!round) return { collection, round: 0, total, seen: 0, attempt: null, completed: false };
  const row = await db.prepare(`SELECT a.*,(SELECT hidden FROM questions WHERE id=a.question_id) hidden,f.question_id IS NOT NULL favorite FROM attempts a LEFT JOIN favorites f ON f.question_id=a.question_id WHERE a.round_id=? AND a.cancelled=0 AND EXISTS(SELECT 1 FROM questions q WHERE q.id=a.question_id AND q.deleted_at IS NULL AND (q.hidden=0 OR a.answered_at IS NOT NULL)) ORDER BY a.rowid DESC LIMIT 1`).bind(round.id).first<DbAttempt>();
  const seen = await db.prepare('SELECT COUNT(*) count FROM attempts a WHERE round_id=? AND cancelled=0 AND EXISTS(SELECT 1 FROM questions q WHERE q.id=a.question_id AND q.deleted_at IS NULL AND q.hidden=0)').bind(round.id).first<{ count: number }>();
  const remaining = await db.prepare('SELECT EXISTS(SELECT 1 FROM questions q WHERE q.deleted_at IS NULL AND q.hidden=0 AND (? IS NULL OR q.collection=?) AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.round_id=? AND a.question_id=q.id)) remaining').bind(collection, collection, round.id).first<{ remaining: number }>();
  const state: PracticeState = { collection, round: round.number, total, seen: seen?.count ?? 0, completed: !remaining?.remaining && (!row || row.answered_at !== null), attempt: null };
  if (row) state.attempt = {
    id: row.id, questionId: row.question_id, text: row.question_text, reading: row.reading,
    collection: row.collection, majorCategory: row.majorCategory, minorCategory: row.minorCategory, retryRequested: Boolean(row.retry_requested) && row.answered_at === null, category: row.category, favorite: Boolean(row.favorite), hidden: Boolean(row.hidden), answered: row.answered_at !== null,
    ...(row.answered_at !== null ? { answer: row.answer, aliases: JSON.parse(row.aliases), retryAliases: JSON.parse(row.retryAliases), note: row.note, source: row.source, submittedAnswer: row.submitted_answer ?? '', correct: Boolean(row.correct), overridden: Boolean(row.overridden), skipped: Boolean(row.skipped) } : {}),
  };
  return state;
}
app.get('/api/practice/options', async c => {
  const db = c.env.DB;
  const rows = await db.prepare(`SELECT s.name,COUNT(q.id) total,
    (SELECT COUNT(*) FROM attempts a WHERE a.round_id=(SELECT id FROM rounds WHERE collection=s.name AND invalidated=0 ORDER BY id DESC LIMIT 1) AND a.answered_at IS NOT NULL AND a.cancelled=0 AND EXISTS(SELECT 1 FROM questions v WHERE v.id=a.question_id AND v.deleted_at IS NULL AND v.hidden=0)) progress
    FROM question_sets s LEFT JOIN questions q ON q.collection=s.name AND q.deleted_at IS NULL AND q.hidden=0 GROUP BY s.name ORDER BY s.name`).all();
  const last = await db.prepare(`SELECT r.collection,r.invalidated FROM settings s JOIN rounds r ON r.id=s.last_practice_round WHERE s.id=1`).first<{ collection: string | null; invalidated: number }>();
  const total = await db.prepare('SELECT COUNT(*) total FROM questions WHERE deleted_at IS NULL AND hidden=0').first<{ total: number }>();
  let resume = null;
  if (last && !last.invalidated) {
    const state = await getPractice(db, last.collection);
    if (state.total) resume = { collection: last.collection, total: state.total, progress: state.seen - (state.attempt && !state.attempt.answered ? 1 : 0) };
  }
  return c.json({ last: resume, collections: rows.results, total: total?.total ?? 0 });
});
app.get('/api/practice', async c => c.json(await getPractice(c.env.DB, practiceScopeSchema.parse(c.req.query('collection') ?? null))));
app.post('/api/practice/select', async c => {
  const { collection } = practiceNextSchema.parse(await c.req.json());
  await c.env.DB.prepare('UPDATE settings SET last_practice_round=(SELECT id FROM rounds WHERE collection IS ? AND invalidated=0 ORDER BY id DESC LIMIT 1) WHERE id=1').bind(collection).run();
  return c.json(await getPractice(c.env.DB, collection));
});
app.post('/api/practice/next', async c => {
  const { newRound, collection } = practiceNextSchema.parse(await c.req.json());
  const db = c.env.DB;
  const state = await getPractice(db, collection);
  if (!state.total) return c.json(state);
  if ((state.attempt && !state.attempt.answered) || (state.completed && !newRound)) {
    await db.prepare('UPDATE settings SET last_practice_round=(SELECT id FROM rounds WHERE collection IS ? AND invalidated=0 ORDER BY id DESC LIMIT 1) WHERE id=1').bind(collection).run();
    return c.json(state);
  }
  // Conditional insert prevents simultaneous devices from creating duplicate rounds.
  await db.prepare(`INSERT INTO rounds(start_key,collection,number) SELECT ?,?,COALESCE((SELECT number+1 FROM rounds WHERE collection IS ? AND invalidated=0 ORDER BY id DESC LIMIT 1),1)
    WHERE NOT EXISTS(SELECT 1 FROM rounds WHERE collection IS ? AND invalidated=0)
    OR NOT EXISTS(SELECT 1 FROM questions q WHERE q.deleted_at IS NULL AND q.hidden=0 AND (? IS NULL OR q.collection=?) AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.round_id=(SELECT id FROM rounds WHERE collection IS ? AND invalidated=0 ORDER BY id DESC LIMIT 1) AND a.question_id=q.id))`)
    .bind(Math.random(), collection, collection, collection, collection, collection, collection).run();
  const round = await db.prepare('SELECT * FROM rounds WHERE collection IS ? AND invalidated=0 ORDER BY id DESC LIMIT 1').bind(collection).first<{ id: number; start_key: number }>();
  if (!round) return c.json(await getPractice(db, collection));
  // Two indexed ranges pick an unseen question without ORDER BY RANDOM() over the whole bank.
  const select = `SELECT q.* FROM questions q WHERE q.deleted_at IS NULL AND q.hidden=0 AND (? IS NULL OR q.collection=?) AND q.random_key %COMPARE% ? AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.round_id=? AND a.question_id=q.id) ORDER BY q.random_key,q.id LIMIT 1`;
  const q = await db.prepare(select.replace('%COMPARE%', '>=' )).bind(collection, collection, round.start_key, round.id).first<DbQuestion>()
    ?? await db.prepare(select.replace('%COMPARE%', '<')).bind(collection, collection, round.start_key, round.id).first<DbQuestion>();
  if (q) await db.prepare(`INSERT OR IGNORE INTO attempts(id,round_id,question_id,question_text,reading,answer,aliases,category,note,source,collection,majorCategory,minorCategory,retryAliases) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM questions WHERE id=? AND deleted_at IS NULL AND hidden=0 AND collection=? AND EXISTS(SELECT 1 FROM rounds WHERE id=? AND invalidated=0)`)
    .bind(crypto.randomUUID(), round.id, q.id, q.text, q.reading, q.answer, q.aliases, q.category, q.note, q.source, q.collection, q.majorCategory, q.minorCategory, q.retryAliases, q.id, q.collection, round.id).run();
  await db.prepare('UPDATE settings SET last_practice_round=? WHERE id=1').bind(round.id).run();
  return c.json(await getPractice(db, collection));
});
async function attemptScope(db: D1Database, roundId: number) {
  return (await db.prepare('SELECT collection FROM rounds WHERE id=?').bind(roundId).first<{ collection: string | null }>())?.collection ?? null;
}
app.post('/api/attempts/:id/answer', async c => {
  const { answer, skip } = z.object({ answer: z.string().trim().max(500).default(''), skip: z.boolean().default(false) }).parse(await c.req.json());
  if (!skip && !answer) return c.json({ error: '答えを入力してください。' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM attempts WHERE id=?').bind(c.req.param('id')).first<DbAttempt>();
  if (!row) return c.json({ error: '解答中の問題が見つかりません。' }, 404);
  if (row.cancelled) return c.json({ error: '問題集の内容が変わりました。問題集を選び直してください。' }, 409);
  const judgment = skip ? 'incorrect' : judgeAnswer(answer, { answer: row.answer, aliases: JSON.parse(row.aliases), retryAliases: JSON.parse(row.retryAliases) });
  if (judgment === 'retry') {
    await c.env.DB.prepare('UPDATE attempts SET retry_requested=1 WHERE id=? AND answered_at IS NULL AND cancelled=0').bind(row.id).run();
    return c.json(await getPractice(c.env.DB, await attemptScope(c.env.DB, row.round_id)));
  }
  const correct = judgment === 'correct';
  await c.env.DB.prepare(`UPDATE attempts SET retry_requested=0,submitted_answer=?,correct=?,skipped=?,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND answered_at IS NULL AND cancelled=0`)
    .bind(answer, correct ? 1 : 0, skip ? 1 : 0, row.id).run();
  return c.json(await getPractice(c.env.DB, await attemptScope(c.env.DB, row.round_id)));
});
app.post('/api/attempts/:id/override', async c => {
  const row = await c.env.DB.prepare('SELECT round_id FROM attempts WHERE id=?').bind(c.req.param('id')).first<{ round_id: number }>();
  if (!row) return c.json({ error: '出題が見つかりません。' }, 404);
  await c.env.DB.prepare('UPDATE attempts SET correct=1,overridden=1 WHERE id=? AND answered_at IS NOT NULL AND cancelled=0 AND skipped=0 AND correct=0').bind(c.req.param('id')).run();
  return c.json(await getPractice(c.env.DB, await attemptScope(c.env.DB, row.round_id)));
});
app.get('/api/history', async c => {
  const page = Math.max(1, Math.min(1000000, Number(c.req.query('page')) || 1));
  const [rows, total] = await Promise.all([
    c.env.DB.prepare(`SELECT id,question_id,question_text,answer,submitted_answer,correct,overridden,skipped,answered_at,(SELECT hidden FROM questions WHERE questions.id=attempts.question_id) hidden FROM attempts WHERE answered_at IS NOT NULL AND cancelled=0 ORDER BY answered_at DESC,rowid DESC LIMIT 20 OFFSET ?`).bind((page - 1) * 20).all(),
    c.env.DB.prepare('SELECT COUNT(*) total FROM attempts WHERE answered_at IS NOT NULL AND cancelled=0').first<{ total: number }>(),
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
    c.env.DB.prepare('SELECT * FROM questions WHERE deleted_at IS NULL ORDER BY id'),
    c.env.DB.prepare('SELECT * FROM favorites'),
    c.env.DB.prepare('SELECT * FROM rounds'),
    c.env.DB.prepare('SELECT * FROM attempts ORDER BY rowid'),
    c.env.DB.prepare('SELECT * FROM settings'),
    c.env.DB.prepare('SELECT * FROM question_sets ORDER BY name'),
    c.env.DB.prepare('SELECT * FROM questions WHERE deleted_at IS NOT NULL ORDER BY id'),
  ]);
  return c.json({ version: 3, deletedQuestions: results[6].results, collections: results[5].results, exportedAt: new Date().toISOString(), questions: results[0].results.map(row => ({ ...row, aliases: JSON.parse(row.aliases as string), retryAliases: JSON.parse(row.retryAliases as string) })), favorites: results[1].results, rounds: results[2].results, attempts: results[3].results, settings: results[4].results });
});
app.all('/api/*', c => c.json({ error: '指定された操作が見つかりません。' }, 404));
app.get('*', c => c.env.ASSETS.fetch(c.req.raw));
export default app;
