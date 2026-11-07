// One-time asset generation. Credentials stay in local configuration, never in output.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

try {
  if (!process.env.GOOGLE_TTS_API_KEY) process.loadEnvFile(fileURLToPath(new URL('../.dev.vars', import.meta.url)));
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error('ローカル設定のGOOGLE_TTS_API_KEYを設定してください。');
  const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ input: { text: '問題' }, voice: { languageCode: 'ja-JP', name: 'ja-JP-Standard-D' }, audioConfig: { audioEncoding: 'MP3' } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`固定音声の生成に失敗しました（HTTP ${response.status}）。`);
  const data = await response.json();
  if (!data.audioContent) throw new Error('音声データがありません。');
  const directory = new URL('../public/audio/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('question.mp3', directory), Buffer.from(data.audioContent, 'base64'));
  console.log('Saved public/audio/question.mp3 (ja-JP-Standard-D: 問題)');
} catch (error) {
  console.error(error instanceof Error && !error.message.includes('fetch') ? error.message : '固定音声の生成に失敗しました。接続と設定を確認してください。');
  process.exitCode = 1;
}
