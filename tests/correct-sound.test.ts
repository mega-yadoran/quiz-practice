import { describe, expect, it, vi } from 'vitest';
import type { PracticeAttempt } from '../shared/model';
import { isNewCorrectResult, playCorrectAnswer } from '../src/speech';

const pending: PracticeAttempt = { id: 'attempt-1', questionId: 'q1', text: '問題', reading: '', category: '', collection: '', majorCategory: '', minorCategory: '', retryRequested: false, answered: false, hidden: false, favorite: false };
const correct = { ...pending, answered: true, correct: true, skipped: false };

describe('正解音を鳴らすタイミング', () => {
  it('新しい正解と手動の正解扱いへの変更で鳴らす', () => {
    expect(isNewCorrectResult(pending, correct)).toBe(true);
    expect(isNewCorrectResult({ ...pending, answered: true, correct: false }, { ...correct, overridden: true })).toBe(true);
  });
  it('不正解・スキップ・未確定・復帰・同じ結果の再送では鳴らさない', () => {
    expect(isNewCorrectResult(pending, { ...correct, correct: false })).toBe(false);
    expect(isNewCorrectResult(pending, { ...correct, skipped: true })).toBe(false);
    expect(isNewCorrectResult(pending, pending)).toBe(false);
    expect(isNewCorrectResult(pending, { ...pending, retryRequested: true })).toBe(false);
    expect(isNewCorrectResult(null, correct)).toBe(false);
    expect(isNewCorrectResult(correct, correct)).toBe(false);
    expect(isNewCorrectResult(pending, { ...correct, id: 'old-attempt' })).toBe(false);
    expect(isNewCorrectResult(pending, null)).toBe(false);
  });
});

describe('正解音の再生', () => {
  const player = () => ({ src: 'old-question', currentTime: 5, playbackRate: 2, onended: vi.fn(), onerror: null, play: vi.fn().mockResolvedValue(undefined) }) as unknown as HTMLAudioElement;
  it('本文用の速度や終了イベントを引き継がず、保存した音声を先頭から再生する', () => {
    const audio = player(); const fail = vi.fn();
    playCorrectAnswer(audio, fail);
    expect(audio.src).toBe('/audio/correct.mp3');
    expect(audio.currentTime).toBe(0);
    expect(audio.playbackRate).toBe(1);
    expect(audio.onended).toBeNull();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
  });
  it('再生失敗を処理し、正解結果の表示は妨げない', async () => {
    const audio = player(); const fail = vi.fn();
    audio.play = vi.fn().mockRejectedValue(new Error('autoplay blocked'));
    playCorrectAnswer(audio, fail);
    await Promise.resolve();
    audio.onerror?.call(audio, new Event('error'));
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
