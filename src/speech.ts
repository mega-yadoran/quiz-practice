import type { PracticeAttempt } from '../shared/model';

// Only a newly confirmed correct result should make a sound, never a restored result.
export function isNewCorrectResult(before: PracticeAttempt | null | undefined, after: PracticeAttempt | null): boolean {
  return Boolean(before && after && before.id === after.id && after.answered && after.correct && !after.skipped && !(before.answered && before.correct));
}

export function playCorrectAnswer(player: HTMLAudioElement, fail: () => void): void {
  let failed = false;
  const onFailure = () => { if (!failed) { failed = true; fail(); } };
  player.onended = null;
  player.onerror = onFailure;
  player.src = '/audio/correct.mp3';
  player.currentTime = 0;
  player.playbackRate = 1;
  void player.play().catch(onFailure);
}

// Play the reusable announcement at normal speed, then leave 0.3 seconds of silence.
export function announceQuestion(player: HTMLAudioElement, readBody: () => void, fail: () => void): () => void {
  let active = true;
  let pause: ReturnType<typeof setTimeout> | undefined;
  const clearHandlers = () => {
    if (player.onended === ended) player.onended = null;
    if (player.onerror === failed) player.onerror = null;
  };
  const failed = () => {
    if (!active) return;
    active = false; clearTimeout(pause); clearHandlers(); fail();
  };
  const ended = () => {
    if (!active || pause !== undefined) return;
    pause = setTimeout(() => {
      if (!active) return;
      active = false; clearHandlers(); readBody();
    }, 300);
  };
  player.src = '/audio/question.mp3';
  player.playbackRate = 1;
  player.onended = ended;
  player.onerror = failed;
  void player.play().catch(failed);
  return () => { active = false; clearTimeout(pause); clearHandlers(); };
}
