import { afterEach, describe, expect, it, vi } from 'vitest';
import app, { type Bindings } from '../worker';
import { synthesize } from '../worker/speech';
import { spokenText } from '../shared/speech';
import { announceQuestion } from '../src/speech';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const voice = 'ja-JP-Chirp3-HD-Kore';
describe('Google音声', () => {
  it('表示用の文章を変えずに全角・半角・入れ子の丸括弧を除く', () => {
    const text = '「鬼に瘤（こぶ）取らるる事」など197の話が収められている、鎌倉時代初期に成立した説話集は何でしょう？';
    expect(spokenText(text)).toBe('「鬼に瘤取らるる事」など197の話が収められている、鎌倉時代初期に成立した説話集は何でしょう？');
    expect(text).toContain('（こぶ）');
    expect(spokenText('前（注(よみ)）中(test)後')).toBe('前中後');
    expect(spokenText('前（未閉じ')).toBe('前');
  });
  it('読み上げ用の文章でも括弧を除き、空になる場合は送信しない', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ audioContent: btoa('MP3') })); vi.stubGlobal('fetch', fetcher);
    await synthesize('瘤（こぶ）(注釈)', 'test-key', voice);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).input.text).toBe('瘤');
    await expect(synthesize('（よみだけ）', 'test-key', voice)).rejects.toThrow('空になります');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('APIキー未設定・不正な音声名・UTF-8上限超過では外部に送らない', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(synthesize('問題', '', voice)).rejects.toThrow('未設定');
    await expect(synthesize('問題', 'test-key', 'invalid')).rejects.toThrow('音声の名前');
    await expect(synthesize('あ'.repeat(1667), 'test-key', voice)).rejects.toThrow('5,000');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['ja-JP-Chirp3-HD-Kore', 'ja-JP-Standard-D'])('日本語の音声%sを指定し、キーをヘッダーだけに入れてMP3を受け取る', async (voice) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ audioContent: btoa('MP3') }));
    vi.stubGlobal('fetch', fetcher);
    expect(new TextDecoder().decode(await synthesize('問題', 'test-key', voice))).toBe('MP3');
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect(request.headers['x-goog-api-key']).toBe('test-key');
    expect(JSON.parse(request.body)).toEqual({ input: { text: '問題' }, voice: { languageCode: 'ja-JP', name: voice }, audioConfig: { audioEncoding: 'MP3' } });
  });
  it('Googleのエラー本文や秘密値を利用者に返さない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-test-key', { status: 403 })));
    await expect(synthesize('問題', 'test-key', voice)).rejects.toThrow('認証に失敗');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-test-key', { status: 429 })));
    await expect(synthesize('問題', 'test-key', voice)).rejects.toThrow('利用上限');
  });
  it('出題スナップショットの読み上げ文を使い、本文や正解の任意送信を受け付けない', async () => {
    const first = vi.fn().mockResolvedValue({ question_text: '元の本文', reading: 'よみあげ文' });
    const bind = vi.fn().mockReturnValue({ first });
    const env = { ENVIRONMENT: 'local', TTS_PROVIDER: 'google', GOOGLE_TTS_API_KEY: 'test-key', DB: { prepare: () => ({ bind }) } } as unknown as Bindings;
    const fetcher = vi.fn().mockResolvedValue(Response.json({ audioContent: btoa('MP3') })); vi.stubGlobal('fetch', fetcher);
    const request = (body: unknown) => app.request('http://127.0.0.1/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    expect((await request({ text: '任意の文章' })).status).toBe(400);
    const response = await request({ attemptId: 'attempt-1', text: '無視する文章' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("media-src 'self' blob:");
    expect(bind).toHaveBeenCalledWith('attempt-1');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).input.text).toBe('よみあげ文');
    first.mockResolvedValue(null);
    expect((await request({ attemptId: 'missing' })).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('音声APIにも認証と送信元の検証を適用する', async () => {
    expect((await app.request('https://quiz.example/api/speech', { method: 'POST' }, { ENVIRONMENT: 'production' } as Bindings)).status).toBe(503);
    expect((await app.request('http://127.0.0.1/api/speech', { method: 'POST', headers: { Origin: 'https://evil.example' } }, { ENVIRONMENT: 'local' } as Bindings)).status).toBe(403);
  });
});

describe('「問題」の告知音声', () => {
  const player = () => ({ src: '', playbackRate: 2, onended: null, onerror: null, play: vi.fn().mockResolvedValue(undefined) }) as unknown as HTMLAudioElement;
  const end = (audio: HTMLAudioElement) => audio.onended?.call(audio, new Event('ended'));
  it('保存済み音声を通常速度で再生し、終了から0.3秒後に本文を開始する', () => {
    vi.useFakeTimers();
    const audio = player(); const body = vi.fn(); const fail = vi.fn();
    announceQuestion(audio, body, fail);
    expect(audio.src).toBe('/audio/question.mp3');
    expect(audio.playbackRate).toBe(1);
    vi.advanceTimersByTime(5000); expect(body).not.toHaveBeenCalled();
    end(audio); vi.advanceTimersByTime(299); expect(body).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(body).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
  });
  it.each([false, true])('告知中・待機中の停止で、古い本文を開始しない（待機中=%s）', (waiting) => {
    vi.useFakeTimers(); const audio = player(); const body = vi.fn();
    const cancel = announceQuestion(audio, body, vi.fn()); const oldEnd = audio.onended;
    if (waiting) end(audio);
    cancel(); oldEnd?.call(audio, new Event('ended')); vi.advanceTimersByTime(2000);
    expect(body).not.toHaveBeenCalled();
  });
  it('告知の再生失敗時は本文を勝手に開始しない', async () => {
    vi.useFakeTimers(); const audio = player(); const body = vi.fn(); const fail = vi.fn();
    audio.play = vi.fn().mockRejectedValue(new Error('blocked'));
    announceQuestion(audio, body, fail); await Promise.resolve(); vi.advanceTimersByTime(2000);
    expect(fail).toHaveBeenCalledTimes(1); expect(body).not.toHaveBeenCalled();
  });
});
