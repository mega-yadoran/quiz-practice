import { spokenText } from '../shared/speech';

export class SpeechError extends Error {
  constructor(message: string, public status: 400 | 502 | 503 | 504) { super(message); }
}

export async function synthesize(text: string, key: string, voice: string): Promise<Uint8Array<ArrayBuffer>> {
  text = spokenText(text);
  if (!text) throw new SpeechError('括弧内を除くと読み上げ文が空になります。問題文を確認してください。', 400);
  if (!key) throw new SpeechError('Google音声のAPIキーが未設定です。.dev.varsのGOOGLE_TTS_API_KEYを設定してください。', 503);
  if (!/^ja-JP-(?:Chirp3-HD-[A-Za-z]+|Standard-[A-F])$/.test(voice)) throw new SpeechError('Google音声の名前を確認してください。', 503);
  if (new TextEncoder().encode(text).length > 5000) throw new SpeechError('読み上げ文がGoogleの上限（UTF-8で5,000バイト）を超えています。読み上げ用の問題文を短くしてください。', 400);
  let response: Response;
  try {
    response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ input: { text }, voice: { languageCode: 'ja-JP', name: voice }, audioConfig: { audioEncoding: 'MP3' } }),
      signal: AbortSignal.timeout(30000),
    });
  } catch { throw new SpeechError('Google音声に接続できませんでした。時間をおいて再度お試しください。', 504); }
  // Never return Google's raw response: it may contain request or credential details.
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? 'Google音声の認証に失敗しました。APIキー・APIの制限・APIの有効化・請求先を確認してください。'
      : response.status === 429 ? 'Google音声の利用上限に達しました。時間をおいて再度お試しください。'
      : 'Google音声の生成に失敗しました。音声名と読み上げ文を確認してください。';
    throw new SpeechError(message, 502);
  }
  try {
    const data = await response.json() as { audioContent?: string };
    if (!data.audioContent) throw new Error();
    return Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0));
  } catch { throw new SpeechError('Googleから音声データを取得できませんでした。', 502); }
}
