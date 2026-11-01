// Gamepad in the menus: the stick / d-pad moves a focus ring between the buttons, A presses, B leaves
// (or goes back), Start readies up, the bumpers flip your character. Also: holding Select shows the
// scoreboard, and the `pad` class on <html> swaps the key hints for pad buttons (`nin` for
// Nintendo-style labels, where A and B, X and Y trade places). In-match movement is input.ts. With
// several seats (split screen) only seat 1's pad drives the menus; padPresses() hands every pad's
// presses to game.ts for the other seats' lobby buttons and for joining.
import { connectedPads, menuSource, noteDevice, padsFor } from './input';
import { gamepadUsed } from './touch';

/** Pads that get Nintendo labels (A/B and X/Y swapped). */
export const NINTENDO = /nintendo|pro controller|joy-con|switch|8bitdo/i;

const A = 0, B = 1, LB = 4, RB = 5, SELECT = 8, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const REPEAT_DELAY = 400, REPEAT_EVERY = 150; // ms, holding a direction

let prev: boolean[] = [];
let prevDir = '';
let repeatAt = 0;
let lastKey = ''; // data-a / data-m of the focused button, to find it again after a re-render
let selectHeld = false;
let capture: ((button: number) => void) | null = null;
let pick: ((pad: Gamepad) => void) | null = null;
let prevAll = new Map<number, boolean[]>(); // per pad index, for picking among every pad
let presses: { pad: Gamepad; button: number }[] = [];

const html = document.documentElement;
const setPad = (on: boolean) => html.classList.toggle('pad', on);
window.addEventListener('keydown', () => { if (typeof menuSource() !== 'object') setPad(false); }, { capture: true });
window.addEventListener('pointerdown', () => setPad(false), { capture: true });

/** Select (−) held: show the scoreboard. */
export function padBoardHeld(): boolean {
  return selectHeld;
}

/** The CONTROLS screen: the next fresh button press goes to `cb` instead of the menus. null cancels. */
export function capturePad(cb: ((button: number) => void) | null): void {
  capture = cb;
}

/** Fresh button presses on every pad this frame. */
export function padPresses(): readonly { pad: Gamepad; button: number }[] {
  return presses;
}

/** The lobby's + PLAYER: the next fresh button press on any pad, even ones the menus ignore, picks it. null cancels. */
export function pickPad(cb: ((pad: Gamepad) => void) | null): void {
  pick = cb;
}

/** Call once a frame. */
export function pollPad(): void {
  const all = connectedPads();
  const pressedOnAll = new Map(all.map(p => [p.index, p.buttons.map(b => b.pressed)]));
  presses = all.flatMap(p => pressedOnAll.get(p.index)!.flatMap((on, i) => (on && !prevAll.get(p.index)?.[i] ? [{ pad: p, button: i }] : [])));
  prevAll = pressedOnAll;
  if (presses.length) noteDevice({ index: presses[0].pad.index, id: presses[0].pad.id });
  if (pick && presses.length) { const cb = pick, fresh = presses[0].pad; pick = null; prev = fresh.buttons.map(b => b.pressed); presses = []; cb(fresh); return; }

  const pads = padsFor(menuSource());
  const now: boolean[] = [];
  let ax = 0, ay = 0;
  for (const p of pads) {
    p.buttons.forEach((b, i) => { now[i] ||= b.pressed; });
    if (Math.hypot(p.axes[0] ?? 0, p.axes[1] ?? 0) > Math.hypot(ax, ay)) { ax = p.axes[0]; ay = p.axes[1]; }
    if (p.buttons.some(b => b.pressed) || Math.hypot(p.axes[0] ?? 0, p.axes[1] ?? 0) > 0.5) {
      setPad(true);
      html.classList.toggle('nin', NINTENDO.test(p.id));
      gamepadUsed();
    }
  }
  const was = prev;
  const down = (i: number) => !!now[i] && !was[i];
  prev = now;
  selectHeld = !!now[SELECT];
  if (capture) {
    // Buttons held when capture started (the A that picked the row) don't count until let go
    const i = now.findIndex((on, i) => on && !was[i]);
    if (i >= 0) { const cb = capture; capture = null; cb(i); }
    return;
  }

  const screen = document.querySelector<HTMLElement>('.ui .screen.on');
  if (!screen || !html.classList.contains('pad') || document.activeElement instanceof HTMLInputElement) return;
  const buttons = [...screen.querySelectorAll<HTMLElement>('button')].filter(b => b.offsetParent !== null);
  if (!buttons.length) return;
  const dir = now[UP] || ay < -0.5 ? 'u' : now[DOWN] || ay > 0.5 ? 'd' : now[LEFT] || ax < -0.5 ? 'l' : now[RIGHT] || ax > 0.5 ? 'r' : '';
  const cur = document.activeElement instanceof HTMLElement && buttons.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) {
    // Nothing focused yet (the press that wakes the pad only shows the ring), or the screen re-rendered under us
    focus(buttons.find(b => lastKey && key(b) === lastKey) ?? buttons.find(b => b.classList.contains('pink')) ?? buttons[0]);
    prevDir = dir;
    repeatAt = performance.now() + REPEAT_DELAY;
    return;
  }

  const t = performance.now();
  if (dir && (dir !== prevDir || t >= repeatAt)) {
    repeatAt = t + (dir !== prevDir ? REPEAT_DELAY : REPEAT_EVERY);
    const next = nearest(cur, buttons, dir);
    if (next) focus(next);
  }
  prevDir = dir;

  const click = (sel: string) => screen.querySelector<HTMLElement>(sel)?.click();
  if (down(A)) cur.click();
  if (down(B)) click('[data-a=leave], [data-a=back]');
  if (down(START)) click('[data-a=ready], [data-a=back]');
  if (down(LB)) click('[data-a=prev]');
  if (down(RB)) click('[data-a=next]');
}

function key(b: HTMLElement): string {
  return b.dataset.a ?? b.dataset.m ?? '';
}

function focus(b: HTMLElement): void {
  b.focus({ preventScroll: true });
  lastKey = key(b);
}

/** The closest button within 45° of a direction, preferring ones in line with this one. */
function nearest(from: HTMLElement, buttons: HTMLElement[], dir: string): HTMLElement | null {
  const c = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const o = c(from);
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const b of buttons) {
    if (b === from) continue;
    const p = c(b), dx = p.x - o.x, dy = p.y - o.y;
    const along = dir === 'u' ? -dy : dir === 'd' ? dy : dir === 'l' ? -dx : dx;
    const across = dir === 'u' || dir === 'd' ? Math.abs(dx) : Math.abs(dy);
    if (along < 4 || across > along) continue;
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = b; }
  }
  return best;
}
