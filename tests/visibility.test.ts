import { describe, expect, it } from 'vitest';
import { visibilitySchema } from '../shared/visibility';
import app, { type Bindings } from '../worker';

describe('出題の非表示設定', () => {
  it('明示した真偽値だけを受け付ける', () => {
    expect(visibilitySchema.parse({ hidden: true })).toEqual({ hidden: true });
    expect(visibilitySchema.parse({ hidden: false })).toEqual({ hidden: false });
    for (const hidden of [undefined, null, 0, 1, 'true', 'false']) expect(visibilitySchema.safeParse({ hidden }).success).toBe(false);
  });
  it('未認証と外部サイトからの変更を拒否する', async () => {
    const path = '/api/questions/test/visibility';
    const body = JSON.stringify({ hidden: true });
    const env = { ENVIRONMENT: 'production', OWNER_EMAIL: 'owner@example.com', ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', ACCESS_AUD: 'aud' } as Bindings;
    expect((await app.request('https://quiz.example.com' + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }, env)).status).toBe(401);
    expect((await app.request('http://127.0.0.1' + path, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' }, body }, { ...env, ENVIRONMENT: 'local' })).status).toBe(403);
  });
});
