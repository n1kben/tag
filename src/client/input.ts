// Keyboard + gamepad → sim Input. Boomerang Fu is a stick game: you face where you move,
// so there's no mouse aim. Space jumps, J or Enter slashes / throws, Q switches grenade.
import { BTN_ACTION, BTN_ALT, BTN_JUMP, type Input } from '../shared/sim';

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
  if (keys.has('KeyJ') || keys.has('Enter') || keys.has('NumpadEnter')) b |= BTN_ACTION;
  if (keys.has('KeyQ')) b |= BTN_ALT;

  for (const pad of navigator.getGamepads?.() ?? []) {
    if (!pad) continue;
    const ax = pad.axes[0] ?? 0, az = pad.axes[1] ?? 0;
    if (Math.hypot(ax, az) > 0.2) { mx = ax; mz = az; }
    const btn = (i: number) => pad.buttons[i]?.pressed;
    if (btn(0)) b |= BTN_JUMP; // A
    if (btn(2) || btn(7)) b |= BTN_ACTION; // X / RT
    if (btn(3) || btn(4) || btn(5)) b |= BTN_ALT; // Y / bumpers: switch grenade
    if (btn(12)) mz = -1;
    if (btn(13)) mz = 1;
    if (btn(14)) mx = -1;
    if (btn(15)) mx = 1;
  }
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  return { mx, mz, b };
}
