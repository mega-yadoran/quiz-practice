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
  const questions = Array.from({ length: 3 }, (_, i) => ({ id: `test-${i}`, text: `テスト問題${i}`, answer: 'ABC', aliases: ['えーびーしー'], collection: '統合テスト本', majorCategory: '科学', minorCategory: '単位', retryAliases: ['もう少し'], category: 'テスト', note: '最初の解説' }));
  assert.deepEqual(await request('/import/preview', 'POST', questions), { existing: [], added: 3, updated: 0 });
  await request('/import', 'POST', questions);
  assert.equal((await request('/questions')).total, 3);
  assert.equal((await request('/questions/test-0')).id, 'test-0');
  assert.equal((await fetch(base + '/api/questions/missing')).status, 404);
  for (const path of ['/practice', '/questions/new', '/questions/test-0/edit', '/questions/import', '/questions/collections', '/favorites', '/history?page=2', '/settings']) {
    const response = await fetch(base + path, { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } });
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).includes('<div id="root"></div>'), path);
  }
  await request('/collections', 'POST', { name: '空の問題集' });
  assert.equal((await request('/collections')).collections.find(c => c.name === '統合テスト本').total, 3);
  assert.equal((await request('/questions?collection=' + encodeURIComponent('空の問題集'))).total, 0);
  assert.equal((await request('/questions?search=' + encodeURIComponent('単位'))).total, 3);
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
      const changed = { ...questions.find(q => q.id === current.attempt.questionId), answer: 'UPDATED', retryAliases: ['更新後の△'], collection: '変更後の本', majorCategory: '変更後', note: '更新後' };
      await request('/import', 'POST', [changed]);
      assert.equal((await request('/questions?favorite=1')).questions[0].answer, 'UPDATED');
      current = await request(`/attempts/${current.attempt.id}/answer`, 'POST', { answer: 'もう少し' });
      assert.equal(current.attempt.answered, false);
      assert.equal(current.attempt.retryRequested, true);
      assert.equal(current.attempt.answer, undefined);
      assert.equal(current.attempt.retryAliases, undefined);
      assert.equal(current.attempt.collection, '統合テスト本');
      assert.equal((await request('/stats')).answered, 0);
      assert.equal((await request('/history')).total, 0);
      assert.equal((await request('/practice')).attempt.retryRequested, true);
      assert.equal((await request('/practice/next', 'POST', {})).attempt.id, current.attempt.id);
      current = await request(`/attempts/${current.attempt.id}/answer`, 'POST', { answer: '　ａｂｃ　' });
      assert.equal(current.attempt.retryRequested, false);
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
  assert.ok(exported.collections.some(c => c.name === '空の問題集'));
  assert.deepEqual(exported.questions[0].retryAliases, exported.questions[0].answer === 'UPDATED' ? ['更新後の△'] : ['もう少し']);
  assert.equal(exported.favorites.length, 1);
  assert.equal(exported.attempts.length, 4);
  const duplicate = await fetch(base + '/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(questions[0]) });
  assert.equal(duplicate.status, 409);
  // Collection management preserves IDs and snapshots, and cancels deleted pending questions.
  const pending = next.attempt;
  const target = exported.questions.find(q => q.id === pending.questionId);
  const oldName = target.collection;
  const newName = '名前変更済み / 問題集';
  const members = exported.questions.filter(q => q.collection === oldName);
  await request('/collections', 'PUT', { name: oldName, newName });
  const renamed = await request('/collections/export?name=' + encodeURIComponent(newName));
  assert.deepEqual(renamed.questions.map(q => q.id).sort(), members.map(q => q.id).sort());
  assert.equal((await request('/practice')).attempt.collection, pending.collection, '出題時の問題集名を保持');
  assert.equal((await request('/collections')).collections.some(c => c.name === oldName), false);
  async function rejectedCollection(method, body, status) {
    const r = await fetch(base + '/api/collections', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(r.status, status);
  }
  await rejectedCollection('PUT', { name: newName, newName: '空の問題集' }, 409);
  await rejectedCollection('PUT', { name: newName, newName: '  ' }, 400);
  await rejectedCollection('DELETE', { name: newName, confirmation: '違う名前', total: members.length }, 400);
  await rejectedCollection('DELETE', { name: '', confirmation: '', total: 0 }, 400);
  await rejectedCollection('DELETE', { name: newName, confirmation: newName, total: members.length + 1 }, 409);
  assert.equal((await request('/stats')).total, 3);
  const beforeDelete = await request('/stats');
  const historyBeforeDelete = await request('/history');
  await request('/favorites/' + pending.questionId, 'PUT', { favorite: true });
  await request('/collections', 'DELETE', { name: newName, confirmation: newName, total: members.length });
  assert.equal((await request('/questions?collection=' + encodeURIComponent(newName))).total, 0);
  assert.equal((await request('/collections')).collections.some(c => c.name === newName), false);
  assert.deepEqual(await request('/history'), historyBeforeDelete, '削除後も回答済み履歴を保持し、中止した出題を履歴に加えない');
  const afterDelete = await request('/stats');
  assert.equal(afterDelete.total, 3 - members.length);
  for (const key of ['answered', 'correct', 'skipped', 'today']) assert.equal(afterDelete[key], beforeDelete[key], key);
  const backup = await request('/export');
  assert.equal(backup.version, 3);
  assert.equal(backup.deletedQuestions.length, members.length);
  for (const member of members) assert.equal((await fetch(base + '/api/questions/' + encodeURIComponent(member.id))).status, 404, 'deleted question cannot be opened for editing');
  assert.equal(backup.favorites.some(f => members.some(q => q.id === f.question_id)), false);
  assert.ok(backup.attempts.find(a => a.id === pending.id).cancelled);
  const stale = await fetch(base + '/api/attempts/' + pending.id + '/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: 'ABC' }) });
  assert.equal(stale.status, 409);
  const resumed = await request('/practice/next', 'POST', { newRound: true });
  assert.ok(!members.some(q => q.id === resumed.attempt?.questionId));
  assert.ok(resumed.seen <= resumed.total);
  await request('/collections', 'DELETE', { name: '空の問題集', confirmation: '空の問題集', total: 0 });
  assert.equal((await request('/collections')).collections.some(c => c.name === '空の問題集'), false);
  // Reimport the saved CSV-equivalent data under the same IDs; history still belongs to those IDs.
  await request('/import', 'POST', renamed.questions);
  assert.equal((await request('/stats')).total, 3);
  assert.equal((await request('/export')).deletedQuestions.length, 0);
  assert.deepEqual((await request('/collections/export?name=' + encodeURIComponent(newName))).questions.map(q => q.id).sort(), members.map(q => q.id).sort());
  // Deleting every remaining collection leaves an empty, resumable practice screen.
  for (const c of (await request('/collections')).collections.filter(c => c.name)) {
    await request('/collections', 'DELETE', { name: c.name, confirmation: c.name, total: c.total });
  }
  assert.equal((await request('/practice/next', 'POST', { newRound: true })).total, 0);
  assert.equal((await request('/history')).total, historyBeforeDelete.total);
  // Independent scopes, including unclassified and names that are not URL-safe.
  const book = '選択 / & ? の本';
  const fixtures = [
    { id: 'scope-a', text: 'A', answer: 'A', retryAliases: ['△'], collection: book },
    { id: 'scope-b', text: 'B', answer: 'A', retryAliases: ['△'], collection: book },
    { id: 'scope-other', text: 'Other', answer: 'A', collection: '*' },
    { id: 'scope-empty', text: 'Unclassified', answer: 'A', collection: '' },
  ];
  await request('/import', 'POST', fixtures);
  const scopeUrl = name => '/practice?collection=' + encodeURIComponent(name);
  const startScope = collection => request('/practice/next', 'POST', { collection });
  const scoped = await Promise.all(Array.from({ length: 5 }, () => startScope(book)));
  assert.equal(new Set(scoped.map(s => s.attempt.id)).size, 1);
  let inBook = scoped[0];
  assert.equal(inBook.total, 2);
  assert.equal(inBook.round, 1);
  assert.equal(inBook.attempt.collection, book);
  const inAll = await startScope(null);
  const inOther = await startScope('*');
  const unclassified = await startScope('');
  assert.equal(unclassified.total, 1);
  assert.equal(unclassified.attempt.questionId, 'scope-empty');
  assert.equal(inOther.total, 1);
  assert.equal((await request(scopeUrl(book))).attempt.id, inBook.attempt.id);
  assert.equal((await request('/practice')).attempt.id, inAll.attempt.id);
  inBook = await request(`/attempts/${inBook.attempt.id}/answer`, 'POST', { answer: '△' });
  assert.equal(inBook.attempt.retryRequested, true, '別の問題集を開いた後も元の範囲の結果を返す');
  assert.equal((await request(scopeUrl(book))).attempt.retryRequested, true);
  // Content edits keep the issued snapshot and progress.
  await request('/questions/' + inBook.attempt.questionId, 'PUT', { ...fixtures.find(q => q.id === inBook.attempt.questionId), answer: 'edited' });
  const finished = await request(`/attempts/${inBook.attempt.id}/answer`, 'POST', { answer: 'A' });
  assert.equal(finished.attempt.correct, true);
  await request('/practice/select', 'POST', { collection: book });
  const opts = await request('/practice/options');
  assert.equal(opts.last.collection, book);
  assert.equal(opts.last.progress, 1);
  assert.equal(opts.collections.find(c => c.name === book).progress, 1);
  const second = await startScope(book);
  assert.notEqual(second.attempt.questionId, inBook.attempt.questionId);
  await request('/collections', 'PUT', { name: book, newName: '改名後' });
  assert.equal((await request(scopeUrl('改名後'))).attempt.id, second.attempt.id, '改名で進捗を保持');
  assert.equal((await request('/practice/options')).last.collection, '改名後');
  const beforeReset = await request('/stats');
  await request('/questions', 'POST', { id: 'scope-added', text: 'Added', answer: 'A', collection: '改名後' });
  assert.equal((await request(scopeUrl('改名後'))).round, 0);
  assert.equal((await request('/practice')).round, 0, '全体練習も問題追加でリセット');
  assert.equal((await request(scopeUrl('*'))).attempt.id, inOther.attempt.id, '別の問題集の進捗は保持');
  assert.equal((await request('/stats')).answered, beforeReset.answered, 'リセット後も確定済み成績を保持');
  const cancelled = await fetch(base + '/api/attempts/' + second.attempt.id + '/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: 'A' }) });
  assert.equal(cancelled.status, 409);
  const restarted = await startScope('改名後');
  assert.equal(restarted.seen, 1);
  assert.equal(restarted.total, 3);
  await request('/questions/scope-other', 'PUT', { ...fixtures[2], collection: '' });
  assert.equal((await request(scopeUrl('*'))).round, 0, '所属の移動で元の問題集をリセット');
  assert.equal((await request(scopeUrl(''))).round, 0, '所属の移動で移動先もリセット');
  assert.equal((await startScope('')).total, 2);
  const invalidScope = await fetch(base + '/api/practice/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection: 123 }) });
  assert.equal(invalidScope.status, 400);
  assert.equal((await startScope('存在しない問題集')).total, 0);
  console.log('PASS: D1実機互換テスト — 取り込み・更新・出題の同時操作・一巡・再開・判定・お気に入り・履歴・設定・書き出し');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  server.kill('SIGTERM');
}
