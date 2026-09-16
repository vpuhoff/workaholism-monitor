let context: AudioContext | undefined;
export async function unlockAudio() {
  context ??= new AudioContext();
  if (context.state === "suspended") await context.resume();
}
export function beep() {
  if (!context || context.state !== "running") return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(0.14, context.currentTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.65);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.7);
}
