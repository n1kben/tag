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

const keys = new Set<string>();
let enabled = true;

window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
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

export function readInput(): Input {
  if (!enabled) return { mx: 0, mz: 0, b: 0 };
  let mx = 0, mz = 0, b = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
  if (keys.has('Space')) b |= BTN_JUMP;
  if (keys.has('KeyJ') || keys.has('Enter') || keys.has('NumpadEnter')) b |= BTN_ACTION | BTN_FLASH;
  if (keys.has('KeyK')) b |= BTN_ACTION | BTN_FROST;

  for (const pad of navigator.getGamepads?.() ?? []) {
    if (!pad) continue;
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
  const touch = readTouch();
  if (touch) {
    if (touch.mx || touch.mz) { mx = touch.mx; mz = touch.mz; }
    b |= touch.b;
  }
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  return { mx, mz, b };
}
