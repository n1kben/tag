// Keyboard + gamepad + touch (touch.ts) → sim Input. Boomerang Fu is a stick game: you face where you move,
// so there's no mouse aim. By default Space jumps; taggers slash with J, K or Enter; runners hold J (or
// Enter) for a flash or K for a frost and let go to throw.
import { BTN_ACTION, BTN_FLASH, BTN_FROST, BTN_JUMP, type Input } from '../shared/sim';
import { gamepadUsed, readTouch } from './touch';

// Bindings per device, remappable on the CONTROLS screen and kept in localStorage: one set for the
// keyboard and one per pad model (by id, so two identical pads share theirs). Pads use standard-mapping
// button numbers. Moving (WASD / arrows, stick, d-pad), the scores (Tab, Select), the menu (Esc, Start)
// and the menu buttons in pad.ts stay fixed.
export type PadAction = 'jump' | 'flash' | 'frost';
export const PAD_ACTIONS: PadAction[] = ['jump', 'flash', 'frost'];
const DEFAULT_PAD: Record<PadAction, number[]> = { jump: [0], flash: [2, 7], frost: [3, 4, 5] }; // A · X, RT · Y, bumpers
const DEFAULT_KEYS: Record<PadAction, string[]> = { jump: ['Space'], flash: ['KeyJ', 'Enter', 'NumpadEnter'], frost: ['KeyK'] };
/** Buttons you can bind, with their Xbox and Nintendo labels. */
export const PAD_BUTTONS: Record<number, [string, string]> = {
  0: ['A', 'B'], 1: ['B', 'A'], 2: ['X', 'Y'], 3: ['Y', 'X'], 4: ['LB', 'L'], 5: ['RB', 'R'],
  6: ['LT', 'ZL'], 7: ['RT', 'ZR'], 10: ['LS', 'LS'], 11: ['RS', 'RS'],
};
const FIXED_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Escape', 'KeyM', 'KeyP']);
const BINDS_KEY = 'binds';
type Saved = { keys?: Record<PadAction, string[]>; pads?: Record<string, Record<PadAction, number[]>> };
let saved = loadBinds();
let version = 0;

function loadBinds(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(BINDS_KEY) ?? 'null');
    if (s && typeof s === 'object') return s;
  } catch { /* fall back to the defaults */ }
  return {};
}

function validPad(b: unknown): b is Record<PadAction, number[]> {
  const r = b as Record<string, unknown> | null;
  return !!r && PAD_ACTIONS.every(a => Array.isArray(r[a]) && (r[a] as unknown[]).every(i => typeof i === 'number' && i in PAD_BUTTONS));
}

function validKeys(b: unknown): b is Record<PadAction, string[]> {
  const r = b as Record<string, unknown> | null;
  return !!r && PAD_ACTIONS.every(a => Array.isArray(r[a]) && (r[a] as unknown[]).every(k => typeof k === 'string' && keyBindable(k)));
}

/** A pad model's buttons for an action. */
export function padBinds(action: PadAction, padId: string): readonly number[] {
  const b = saved.pads?.[padId];
  return (validPad(b) ? b : DEFAULT_PAD)[action];
}

/** The keyboard's keys for an action (KeyboardEvent.code). */
export function keyBinds(action: PadAction): readonly string[] {
  return (validKeys(saved.keys) ? saved.keys : DEFAULT_KEYS)[action];
}

/** Changes whenever a binding does (HUD hints cache on it). */
export function bindsVersion(): number {
  return version;
}

export function keyBindable(code: string): boolean {
  return !FIXED_KEYS.has(code) && /^(Key|Digit|Numpad|Space|Enter|Shift|Control|Alt|Comma|Period|Slash|Semicolon|Quote|Bracket|Backslash|Minus|Equal|Backquote)/.test(code);
}

/** "KeyJ" → "J", "ShiftLeft" → "L Shift". */
export function keyName(code: string): string {
  const side = /Left$/.test(code) ? 'L ' : /Right$/.test(code) ? 'R ' : '';
  return side + code.replace(/^Key|^Digit|Left$|Right$/g, '').replace(/^Numpad/, 'Num ');
}

/** Bind a key (device 'keys') or a pad button (device = pad id) to an action, replacing what it had; it leaves any other action. */
export function setBind(device: string, action: PadAction, value: string | number): void {
  if (device === 'keys') {
    if (typeof value !== 'string' || !keyBindable(value)) return;
    const b = { jump: [...keyBinds('jump')], flash: [...keyBinds('flash')], frost: [...keyBinds('frost')] };
    for (const a of PAD_ACTIONS) b[a] = b[a].filter(k => k !== value);
    b[action] = [value];
    saved.keys = b;
  } else {
    if (typeof value !== 'number' || !(value in PAD_BUTTONS)) return;
    const b = { jump: [...padBinds('jump', device)], flash: [...padBinds('flash', device)], frost: [...padBinds('frost', device)] };
    for (const a of PAD_ACTIONS) b[a] = b[a].filter(i => i !== value);
    b[action] = [value];
    saved.pads = { ...saved.pads, [device]: b };
  }
  store();
}

export function resetBinds(device: string): void {
  if (device === 'keys') delete saved.keys;
  else if (saved.pads) delete saved.pads[device];
  store();
}

function store(): void {
  version++;
  localStorage.setItem(BINDS_KEY, JSON.stringify(saved));
}

// Which device a local player (a split-screen seat, see game.ts) follows: the keyboard, or one pad.
// A pad is kept by index and id: indexes can shift on reconnect, so a free pad with the same id takes over.
export type InputSource = 'keys' | { index: number; id: string };
let seatSrcs: InputSource[] = ['keys'];
let lastUsed: InputSource | null = null; // null: only the mouse so far

/** game.ts: the devices of the seats, in seat order. */
export function setSeatSources(list: InputSource[]): void {
  seatSrcs = list;
}

let menuOwner: InputSource | null = null;

/** The device that drives the menus: whoever opened the in-match menu, else seat 1's. */
export function menuSource(): InputSource {
  return menuOwner ?? seatSrcs[0] ?? 'keys';
}

export function setMenuOwner(src: InputSource | null): void {
  menuOwner = src;
}

export function sameSource(a: InputSource, b: InputSource): boolean {
  return a === b || (typeof a === 'object' && typeof b === 'object' && a.index === b.index);
}

/** Some seat has this device. */
export function sourceTaken(src: InputSource): boolean {
  return seatSrcs.some(s => sameSource(s, src));
}

/** The device last pressed: a key (outside text fields), or a pad button (pad.ts reports those). */
export function lastDevice(): InputSource | null {
  return lastUsed;
}

/** Buzz a pad (Chrome; a no-op where unsupported): the lobby shows whose pad is whose this way. */
export function rumble(src: InputSource, ms = 160, strength = 0.6): void {
  if (src === 'keys') return;
  for (const pad of padsFor(src)) {
    const act = (pad as Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }).vibrationActuator;
    act?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: strength, strongMagnitude: strength })?.catch(() => {});
  }
}

export function noteDevice(src: InputSource): void {
  lastUsed = src;
}

export function connectedPads(): Gamepad[] {
  return (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p);
}

/** The pads a device means: none for the keyboard, else the one pad (following it to a new index). */
export function padsFor(src: InputSource): Gamepad[] {
  const all = connectedPads();
  if (src === 'keys') return [];
  const taken = (p: Gamepad) => seatSrcs.some(s => s !== src && typeof s === 'object' && s.index === p.index);
  const pad = all.find(p => p.index === src.index && p.id === src.id) ?? all.find(p => p.id === src.id && !taken(p));
  if (!pad) return [];
  src.index = pad.index;
  return [pad];
}

const keys = new Set<string>();
let enabled = true;

window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  lastUsed = 'keys';
  if (['Space', 'Enter', 'NumpadEnter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

export function setInputEnabled(v: boolean): void {
  enabled = v;
  if (!v) keys.clear();
}

export function isHeld(code: string): boolean {
  return keys.has(code);
}

/** One seat's input this tick; touch too for a lone player. */
export function readInput(src: InputSource, touch: boolean): Input {
  if (!enabled) return { mx: 0, mz: 0, b: 0 };
  let mx = 0, mz = 0, b = 0;
  if (src === 'keys') {
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
    const held = (a: PadAction) => keyBinds(a).some(k => keys.has(k));
    if (held('jump')) b |= BTN_JUMP;
    if (held('flash')) b |= BTN_ACTION | BTN_FLASH; // slash, or a flash
    if (held('frost')) b |= BTN_ACTION | BTN_FROST; // slash, or a frost
  }

  for (const pad of padsFor(src)) {
    const ax = pad.axes[0] ?? 0, az = pad.axes[1] ?? 0;
    if (Math.hypot(ax, az) > 0.2) { mx = ax; mz = az; gamepadUsed(); }
    const btn = (i: number) => pad.buttons[i]?.pressed;
    if (pad.buttons.some(x => x.pressed)) gamepadUsed();
    if (padBinds('jump', pad.id).some(btn)) b |= BTN_JUMP;
    if (padBinds('flash', pad.id).some(btn)) b |= BTN_ACTION | BTN_FLASH;
    if (padBinds('frost', pad.id).some(btn)) b |= BTN_ACTION | BTN_FROST;
    if (btn(12)) mz = -1;
    if (btn(13)) mz = 1;
    if (btn(14)) mx = -1;
    if (btn(15)) mx = 1;
  }
  const t = touch ? readTouch() : null;
  if (t) {
    if (t.mx || t.mz) { mx = t.mx; mz = t.mz; }
    b |= t.b;
  }
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  return { mx, mz, b };
}
