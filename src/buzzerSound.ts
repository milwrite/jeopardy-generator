// Original four-note cue synthesized here; no recorded or broadcast audio is used.
export function playBuzzerCue(context: AudioContext): void {
  if (context.state !== 'running') return;
  const start = context.currentTime;
  [587.33, 739.99, 880, 1174.66].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + index * 0.055;
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.11, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.19);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.2);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}

export function createCueGate(storage: Pick<Storage, 'getItem' | 'setItem'>, roomCode: string) {
  let initialized = false;
  const seen = new Set<string>();
  return (firstBuzzId: string | null | undefined, muted: boolean): boolean => {
    const firstSnapshot = !initialized;
    initialized = true;
    if (!firstBuzzId || seen.has(firstBuzzId)) return false;
    seen.add(firstBuzzId);
    const key = `jeopardy.buzzer.heard.${roomCode}`;
    let previous: string | null = null;
    try { previous = storage.getItem(key); storage.setItem(key, firstBuzzId); } catch { /* In-memory gate still prevents retry sounds. */ }
    // Initial state is history, not a new event. Mark muted events heard as well.
    return !firstSnapshot && previous !== firstBuzzId && !muted;
  };
}
