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
