// Keyboard + gamepad + touch (touch.ts) → sim Input. Boomerang Fu is a stick game: you face where you move,
// so there's no mouse aim. Space jumps; taggers slash with J, K or Enter; runners hold J (or
// Enter) for a flash or K for a frost and let go to throw.
import { BTN_ACTION, BTN_FLASH, BTN_FROST, BTN_JUMP, type Input } from '../shared/sim';
import { gamepadUsed, readTouch } from './touch';

// Pad buttons per action, remappable on the CONTROLS screen and kept in localStorage. Standard-mapping
// button numbers; the stick, d-pad, Select (scoreboard) and the menu buttons in pad.ts stay fixed.
export type PadAction = 'jump' | 'flash' | 'frost';
export const PAD_ACTIONS: PadAction[] = ['jump', 'flash', 'frost'];
const DEFAULT_BINDS: Record<PadAction, number[]> = { jump: [0], flash: [2, 7], frost: [3, 4, 5] }; // A · X, RT · Y, bumpers
/** Buttons you can bind, with their Xbox and Nintendo labels. */
export const PAD_BUTTONS: Record<number, [string, string]> = {
  0: ['A', 'B'], 1: ['B', 'A'], 2: ['X', 'Y'], 3: ['Y', 'X'], 4: ['LB', 'L'], 5: ['RB', 'R'],
  6: ['LT', 'ZL'], 7: ['RT', 'ZR'], 9: ['Start', '+'], 10: ['LS', 'LS'], 11: ['RS', 'RS'],
};
const BINDS_KEY = 'padBinds';
let binds = loadBinds();

function loadBinds(): Record<PadAction, number[]> {
  try {
    const saved = JSON.parse(localStorage.getItem(BINDS_KEY) ?? 'null');
    if (saved && PAD_ACTIONS.every(a => Array.isArray(saved[a]) && saved[a].every((i: unknown) => typeof i === 'number' && i in PAD_BUTTONS))) return saved;
  } catch { /* fall back to the defaults */ }
  return structuredClone(DEFAULT_BINDS);
}

export function padBinds(action: PadAction): readonly number[] {
  return binds[action];
}

/** Bind a button to an action, replacing what it had; the button leaves any other action. */
export function setPadBind(action: PadAction, button: number): void {
  if (!(button in PAD_BUTTONS)) return;
  for (const a of PAD_ACTIONS) binds[a] = binds[a].filter(i => i !== button);
  binds[action] = [button];
  localStorage.setItem(BINDS_KEY, JSON.stringify(binds));
}

export function resetPadBinds(): void {
  binds = structuredClone(DEFAULT_BINDS);
  localStorage.removeItem(BINDS_KEY);
}

// Which device a local player (a split-screen seat, see game.ts) follows: any (keyboard, touch and
// every pad, for one player alone), the keyboard only, or one pad. A pad is kept by index and id:
// indexes can shift on reconnect, so a free pad with the same id takes over.
export type InputSource = 'any' | 'keys' | { index: number; id: string };
let seatSrcs: InputSource[] = ['any'];
let lastUsed: InputSource = 'keys';

/** game.ts: the devices of the seats, in seat order. */
export function setSeatSources(list: InputSource[]): void {
  seatSrcs = list;
}

/** Seat 1's device: the one that drives the menus. */
export function menuSource(): InputSource {
  return seatSrcs[0] ?? 'any';
}

export function sameSource(a: InputSource, b: InputSource): boolean {
  return a === b || (typeof a === 'object' && typeof b === 'object' && a.index === b.index);
}

/** Some seat has this device (a lone 'any' seat has them all). */
export function sourceTaken(src: InputSource): boolean {
  return seatSrcs.some(s => s === 'any' || sameSource(s, src));
}

/** The device last pressed: a key, or a pad button (pad.ts reports those). */
export function lastDevice(): InputSource {
  return lastUsed;
}

export function noteDevice(src: InputSource): void {
  lastUsed = src;
}

export function connectedPads(): Gamepad[] {
  return (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p);
}

/** The pads a device means: every pad, none, or the one pad (following it to a new index). */
export function padsFor(src: InputSource): Gamepad[] {
  const all = connectedPads();
  if (src === 'any') return all;
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

/** One seat's input this tick; touch only for a lone player. */
export function readInput(src: InputSource, touch: boolean): Input {
  if (!enabled) return { mx: 0, mz: 0, b: 0 };
  let mx = 0, mz = 0, b = 0;
  if (src === 'any' || src === 'keys') {
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
    if (keys.has('Space')) b |= BTN_JUMP;
    if (keys.has('KeyJ') || keys.has('Enter') || keys.has('NumpadEnter')) b |= BTN_ACTION | BTN_FLASH;
    if (keys.has('KeyK')) b |= BTN_ACTION | BTN_FROST;
  }

  for (const pad of padsFor(src)) {
    const ax = pad.axes[0] ?? 0, az = pad.axes[1] ?? 0;
    if (Math.hypot(ax, az) > 0.2) { mx = ax; mz = az; gamepadUsed(); }
    const btn = (i: number) => pad.buttons[i]?.pressed;
    if (pad.buttons.some(x => x.pressed)) gamepadUsed();
    if (binds.jump.some(btn)) b |= BTN_JUMP;
    if (binds.flash.some(btn)) b |= BTN_ACTION | BTN_FLASH; // slash, or a flash
    if (binds.frost.some(btn)) b |= BTN_ACTION | BTN_FROST; // slash, or a frost
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
