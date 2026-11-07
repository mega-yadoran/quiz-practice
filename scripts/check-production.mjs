// Check that the public app and API still require the expected Access login.
// This deliberately does not read login cookies or bypass authentication.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const base = 'https://q-practice.yado-quiz.workers.dev';
const issuer = config.vars.ACCESS_TEAM_DOMAIN;
assert.ok(issuer, 'ACCESS_TEAM_DOMAIN is missing');

for (const path of ['/', '/practice', '/questions', '/questions/new', '/questions/example/edit', '/questions/import', '/questions/collections', '/favorites', '/favorites/example/edit', '/history', '/settings', '/api/me', '/api/questions/example', '/favicon.svg']) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      try {
        assert.equal(response.status, 302, `${path}: expected an Access redirect, got ${response.status}`);
        const location = new URL(response.headers.get('location') ?? '', base);
        assert.equal(location.protocol, 'https:');
        assert.equal(location.hostname, issuer, `${path}: redirected to an unexpected host`);
        assert.ok(location.pathname.startsWith('/cdn-cgi/access/login/'), `${path}: not an Access login URL`);
      } finally {
        await response.body?.cancel();
      }
      lastError = undefined;
      console.log(`PASS: ${path} requires Cloudflare Access`);
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
}
