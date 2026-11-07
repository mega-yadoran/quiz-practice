export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch { throw new Error('接続できません。インターネット接続を確認してください。'); }
  const json = response.headers.get('Content-Type')?.includes('application/json');
  if (!json) throw new Error(response.status === 401 || response.status === 403 || response.redirected ? 'ログインを確認するため、ページを開き直してください。' : 'アプリに接続できません。公開設定やサーバーの起動を確認してください。');
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error ?? '処理に失敗しました。');
  return data as T;
}
export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
