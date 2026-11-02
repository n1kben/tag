// Tiny WebAudio synth: Boomerang Fu-ish "pings, zaps and kung fu punch effects", no assets.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

// ── Volume: Music and Sound in four steps, kept in localStorage ──
export type Level = 0 | 1 | 2 | 3;
export const LEVEL_NAMES = ['OFF', 'LOW', 'MED', 'HIGH'] as const;
const LEVEL_GAIN = [0, 0.3, 0.6, 1];
const VOLUME_KEY = 'volume';
type Volumes = { music: Level; sound: Level };
const vol: Volumes = loadVolumes();
let loud: Volumes = { ...vol }; // the levels M and the touch speaker bring back

function loadVolumes(): Volumes {
  const ok = (v: unknown): v is Level => v === 0 || v === 1 || v === 2 || v === 3;
  try {
    const s = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null');
    if (ok(s?.music) && ok(s?.sound)) return { music: s.music, sound: s.sound };
  } catch { /* fall back to the defaults */ }
  return { music: 3, sound: 3 };
}

export function volumes(): Readonly<Volumes> { return vol; }

export function setVolume(kind: keyof Volumes, level: Level): void {
  vol[kind] = level;
  if (level) loud[kind] = level;
  try { localStorage.setItem(VOLUME_KEY, JSON.stringify(vol)); } catch { /* private mode: this visit only */ }
  if (ctx && sfxBus && musicBus) {
    sfxBus.gain.setTargetAtTime(LEVEL_GAIN[vol.sound], ctx.currentTime, 0.03);
    musicBus.gain.setTargetAtTime(MUSIC_VOL * LEVEL_GAIN[vol.music], ctx.currentTime, 0.03);
  }
  applyMusic();
}

/** M: music off, or back on at its old level. */
export function toggleMusic(): void {
  setVolume('music', vol.music ? 0 : loud.music);
}

/** The touch speaker: everything on → music off → everything off → on again. Returns its icon. */
export function cycleQuiet(): string {
  if (vol.music && vol.sound) setVolume('music', 0);
  else if (vol.sound) setVolume('sound', 0);
  else { setVolume('sound', loud.sound); setVolume('music', loud.music); }
  return quietIcon();
}
export function quietIcon(): string { return vol.sound ? (vol.music ? '🔊' : '🔈') : '🔇'; }

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = LEVEL_GAIN[vol.sound];
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = MUSIC_VOL * LEVEL_GAIN[vol.music];
      musicBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  applyMusic();
  return ctx;
}

// ── Music: streamed <audio> loops on the music bus, crossfaded on screen changes ──
export type Track = 'lobby' | 'match';
const MUSIC_VOL = 0.4; // at HIGH, against the synth effects at HIGH
const MUSIC_FADE = 1.5; // seconds of crossfade between songs
const tracks = new Map<Track, { el: HTMLAudioElement; gain: GainNode }>();
let wanted: Track | null = null;
let playing: Track | null = null;
let fadeIn = MUSIC_FADE;

function applyMusic(): void {
  const target = vol.music ? wanted : null; // music OFF: nothing streams
  if (!ctx || !musicBus || target === playing) return;
  const c = ctx;
  const t = c.currentTime;
  const old = playing ? tracks.get(playing) : undefined;
  if (old) {
    old.gain.gain.cancelScheduledValues(t);
    old.gain.gain.setValueAtTime(old.gain.gain.value, t);
    old.gain.gain.linearRampToValueAtTime(0, t + MUSIC_FADE);
    const el = old.el;
    setTimeout(() => { if (tracks.get(playing!)?.el !== el) el.pause(); }, MUSIC_FADE * 1000 + 100);
  }
  const want = playing = target;
  if (!want) return;
  let tr = tracks.get(want);
  if (!tr) {
    const el = new Audio(`/music/${want}.ogg`);
    el.loop = true;
    const gain = c.createGain();
    gain.gain.value = 0;
    c.createMediaElementSource(el).connect(gain).connect(musicBus);
    tr = { el, gain };
    tracks.set(want, tr);
  }
  tr.el.currentTime = 0;
  void tr.el.play().catch(() => { if (playing === want) playing = null; }); // retried on the next gesture/sound
  tr.gain.gain.cancelScheduledValues(t);
  tr.gain.gain.setValueAtTime(0, t);
  tr.gain.gain.linearRampToValueAtTime(1, t + fadeIn);
}

/** Which song should be playing (null = silence). Starts once the browser allows audio; the old one fades out. */
export function music(track: Track | null, fade = MUSIC_FADE): void {
  wanted = track;
  fadeIn = fade;
  ac();
}

// Browsers only allow audio after a gesture
window.addEventListener('pointerdown', () => ac());
window.addEventListener('keydown', () => ac());

function tone(freq: number, to: number, dur: number, type: OscillatorType, vol: number, delay = 0, pan = 0): void {
  // Exponential ramps can't target 0, and inaudible sounds aren't worth scheduling
  if (!(vol > 0.002) || !volumes().sound) return;
  const c = ac();
  if (!c || !sfxBus) return;
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
  o.connect(g).connect(p).connect(sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol: number, f0: number, f1: number, q = 1, delay = 0, type: BiquadFilterType = 'bandpass', pan = 0): void {
  if (!(vol > 0.002) || !volumes().sound) return;
  const c = ac();
  if (!c || !sfxBus || !noiseBuf) return;
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
  s.connect(f).connect(g).connect(p).connect(sfxBus);
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
    // "Taggers released": kung-fu movie gong
    tone(196, 180, 1.6, 'sine', 0.4);
    tone(392, 370, 1.2, 'triangle', 0.15);
    noise(0.5, 0.25, 600, 200, 0.6, 0, 'bandpass');
  },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.16, i * 0.09)); },
  lose() { [523, 440, 349].forEach((f, i) => tone(f, f * 0.98, 0.28, 'triangle', 0.14, i * 0.14)); },
  ui() { tone(700, 1100, 0.06, 'sine', 0.1); },
  boing(v = 1, pan = 0) { tone(180, 720, 0.18, 'sine', 0.35 * v, 0, pan); tone(360, 1200, 0.12, 'triangle', 0.12 * v, 0.02, pan); },
  creak(v = 1, pan = 0) { tone(140, 95, 0.35, 'sawtooth', 0.06 * v, 0, pan); noise(0.3, 0.08 * v, 400, 250, 6, 0, 'bandpass', pan); },
  crash(v = 1, pan = 0) {
    noise(0.45, 0.4 * v, 1800, 200, 0.8, 0, 'lowpass', pan);
    for (let i = 0; i < 3; i++) tone(260 - i * 40, 120, 0.12, 'square', 0.06 * v, 0.05 + i * 0.07, pan);
  },
};
