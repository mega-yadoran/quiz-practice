// Exercise the real Worker and D1 emulator with a fresh, isolated local database.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const state = resolve(root, '.wrangler', `integration-${crypto.randomUUID()}`);
const probe = createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
const migrated = spawnSync(process.execPath, [cli, 'd1', 'migrations', 'apply', 'q-practice', '--local', '--config', 'wrangler.local.jsonc', '--persist-to', state], { cwd: root, env, encoding: 'utf8' });
assert.equal(migrated.status, 0, migrated.stderr + migrated.stdout);
const server = spawn(process.execPath, [cli, 'dev', '--config', 'wrangler.local.jsonc', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', d => { logs = (logs + d).slice(-12000); });
server.stderr.on('data', d => { logs = (logs + d).slice(-12000); });
const base = `http://127.0.0.1:${port}`;
async function request(path, method = 'GET', body) {
  const r = await fetch(base + '/api' + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json();
  assert.ok(r.ok, `${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + '/api/me'); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(ready, logs);
  assert.equal((await request('/stats')).total, 0);
  const questions = Array.from({ length: 3 }, (_, i) => ({ id: `test-${i}`, text: `テスト問題${i}`, answer: 'ABC', aliases: ['えーびーしー'], category: 'テスト', note: '最初の解説' }));
  assert.deepEqual(await request('/import/preview', 'POST', questions), { existing: [], added: 3, updated: 0 });
  await request('/import', 'POST', questions);
  assert.equal((await request('/questions')).total, 3);
  const seen = new Set();
  let current;
  for (let i = 0; i < 3; i++) {
    const states = await Promise.all(Array.from({ length: 5 }, () => request('/practice/next', 'POST', {})));
    assert.equal(new Set(states.map(s => s.attempt.id)).size, 1, '同時操作で複数出題しない');
    current = states[0];
    assert.equal(current.attempt.answer, undefined, '未回答時は正解を返さない');
    assert.ok(!seen.has(current.attempt.questionId), '一巡内で同じ問題を出さない');
    seen.add(current.attempt.questionId);
    assert.equal((await request('/practice')).attempt.id, current.attempt.id, '再読込で進み具合を維持');
    if (i === 0) {
      await request(`/favorites/${current.attempt.questionId}`, 'PUT', { favorite: true });
      const changed = { ...questions.find(q => q.id === current.attempt.questionId), answer: 'UPDATED', note: '更新後' };
      await request('/import', 'POST', [changed]);
      assert.equal((await request('/questions?favorite=1')).questions[0].answer, 'UPDATED');
      current = await request(`/attempts/${current.attempt.id}/answer`, 'POST', { answer: '　ａｂｃ　' });
      assert.equal(current.attempt.correct, true, '出題時点の正解で判定');
      assert.equal(current.attempt.note, '最初の解説', '出題時点の解説を保持');
      assert.equal(current.attempt.favorite, true, '更新後もお気に入り維持');
      await request(`/attempts/${current.attempt.id}/answer`, 'POST', { answer: '違う' });
      assert.equal((await request('/stats')).answered, 1, '再送で履歴を増やさない');
    } else if (i === 1) {
      current = await request(`/attempts/${current.attempt.id}/answer`, 'POST', { answer: '不正解' });
      assert.equal(current.attempt.correct, false);
      current = await request(`/attempts/${current.attempt.id}/override`, 'POST', {});
      assert.equal(current.attempt.overridden, true);
      assert.equal(current.attempt.correct, true);
    } else {
      current = await request(`/attempts/${current.attempt.id}/answer`, 'POST', { skip: true });
      assert.equal(current.attempt.skipped, true);
    }
  }
  assert.equal(seen.size, 3);
  assert.equal(current.completed, true);
  assert.equal((await request('/practice/next', 'POST', {})).completed, true, '明示操作まで次の一巡を始めない');
  const stats = await request('/stats');
  assert.equal(stats.answered, 2);
  assert.equal(stats.correct, 2);
  assert.equal(stats.skipped, 1);
  assert.equal((await request('/history')).total, 3);
  assert.equal((await request('/questions?search=%25')).total, 0, '検索の%をワイルドカードにしない');
  assert.equal((await request('/import/preview', 'POST', questions)).updated, 3);
  const next = await request('/practice/next', 'POST', { newRound: true });
  assert.equal(next.round, 2);
  assert.equal(next.seen, 1);
  await request('/settings', 'PUT', { rate: 1.3, showQuestion: true });
  assert.deepEqual(await request('/settings'), { rate: 1.3, showQuestion: true });
  const exported = await request('/export');
  assert.equal(exported.questions.length, 3);
  assert.equal(exported.favorites.length, 1);
  assert.equal(exported.attempts.length, 4);
  const duplicate = await fetch(base + '/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(questions[0]) });
  assert.equal(duplicate.status, 409);
  console.log('PASS: D1実機互換テスト — 取り込み・更新・出題の同時操作・一巡・再開・判定・お気に入り・履歴・設定・書き出し');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  server.kill('SIGTERM');
}
