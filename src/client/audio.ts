// Tiny WebAudio synth: Boomerang Fu-ish "pings, zaps and kung fu punch effects", no assets.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Browsers only allow audio after a gesture
window.addEventListener('pointerdown', () => ac(), { once: true });
window.addEventListener('keydown', () => ac(), { once: true });

export function setMuted(v: boolean): void {
  muted = v;
  if (master) master.gain.value = v ? 0 : 0.5;
}
export function isMuted(): boolean { return muted; }

function tone(freq: number, to: number, dur: number, type: OscillatorType, vol: number, delay = 0, pan = 0): void {
  // Exponential ramps can't target 0, and inaudible sounds aren't worth scheduling
  if (!(vol > 0.002)) return;
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  const p = c.createStereoPanner();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  p.pan.value = pan;
  o.connect(g).connect(p).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol: number, f0: number, f1: number, q = 1, delay = 0, type: BiquadFilterType = 'bandpass', pan = 0): void {
  if (!(vol > 0.002)) return;
  const c = ac();
  if (!c || !master || !noiseBuf) return;
  const t = c.currentTime + delay;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const p = c.createStereoPanner();
  p.pan.value = pan;
  s.connect(f).connect(g).connect(p).connect(master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
}

/** Volume falloff + stereo for a world position relative to the listener. */
export function spatial(x: number, z: number, lx: number, lz: number): { vol: number; pan: number } {
  const d = Math.hypot(x - lx, z - lz);
  return { vol: Math.max(0, 1 - d / 26), pan: Math.max(-1, Math.min(1, (x - lx) / 14)) };
}

export const sfx = {
  jump(v = 1, pan = 0) { tone(320, 620, 0.12, 'sine', 0.12 * v, 0, pan); },
  land(v = 1, pan = 0) { noise(0.09, 0.18 * v, 400, 120, 1, 0, 'lowpass', pan); },
  swish(v = 1, pan = 0) { noise(0.16, 0.35 * v, 900, 4200, 2.5, 0, 'bandpass', pan); },
  hit(v = 1, pan = 0) {
    tone(180, 60, 0.18, 'sine', 0.5 * v, 0, pan);
    noise(0.1, 0.4 * v, 2500, 600, 1, 0, 'bandpass', pan);
  },
  kill(v = 1, pan = 0) {
    tone(140, 45, 0.3, 'sine', 0.6 * v, 0, pan);
    noise(0.22, 0.5 * v, 3000, 300, 0.8, 0, 'bandpass', pan);
    tone(1320, 1320, 0.25, 'triangle', 0.12 * v, 0.06, pan);
    tone(1760, 1760, 0.3, 'triangle', 0.1 * v, 0.12, pan);
  },
  throw(v = 1, pan = 0) { noise(0.2, 0.22 * v, 600, 2400, 3, 0, 'bandpass', pan); },
  bounce(v = 1, pan = 0) { tone(900, 700, 0.05, 'square', 0.04 * v, 0, pan); },
  flash(v = 1, pan = 0) {
    noise(0.35, 0.5 * v, 6000, 2000, 0.5, 0, 'highpass', pan);
    tone(2600, 2400, 1.2, 'sine', 0.08 * v, 0.02, pan);
  },
  frost(v = 1, pan = 0) {
    [1568, 2093, 2637, 3136].forEach((f, i) => tone(f, f * 1.01, 0.25, 'triangle', 0.1 * v, i * 0.045, pan));
    noise(0.4, 0.2 * v, 5000, 8000, 4, 0, 'bandpass', pan);
  },
  hurt() { tone(500, 220, 0.2, 'sawtooth', 0.12); },
  beep(high = false) { tone(high ? 1320 : 880, high ? 1320 : 880, high ? 0.35 : 0.12, 'square', 0.08); },
  gong() {
    // "Seekers released": kung-fu movie gong
    tone(196, 180, 1.6, 'sine', 0.4);
    tone(392, 370, 1.2, 'triangle', 0.15);
    noise(0.5, 0.25, 600, 200, 0.6, 0, 'bandpass');
  },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.16, i * 0.09)); },
  lose() { [523, 440, 349].forEach((f, i) => tone(f, f * 0.98, 0.28, 'triangle', 0.14, i * 0.14)); },
  ui() { tone(700, 1100, 0.06, 'sine', 0.1); },
};
