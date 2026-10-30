// On-screen controls for phones and tablets: a floating stick anywhere on the left half, buttons
// bottom-right (jump + flash/frost for runners, jump + slash for taggers, "next" when spectating).
// They show up once a finger touches the screen and hide again on a key press or gamepad input.
// Also: fullscreen on the first menu tap (Android, iPad; iPhone Safari can't, use Add to Home Screen).
import { BTN_ACTION, BTN_FLASH, BTN_FROST, BTN_JUMP, type Role } from '../shared/sim';
import type { NadeKind } from '../shared/constants';
import { isMuted, setMuted } from './audio';

export interface TouchHud { role: Role; alive: boolean; nades: Record<NadeKind, number>; spectating: boolean }

const STICK_R = 56; // px the knob travels; full speed at 85% of it
const DEADZONE = 0.12;

const CSS = `
html.touch, html.touch body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
html.touch input { -webkit-user-select: text; user-select: text; }
html.touch canvas { touch-action: none; }
.tpad { position: fixed; top: 0; left: 0; right: 0; height: var(--app-h); z-index: 12; pointer-events: none; display: none; font-family: 'Lilita One', sans-serif; }
html.touch .tpad.on { display: block; }
.tpad .zone { position: absolute; left: 0; top: 70px; bottom: 0; width: 50%; pointer-events: auto; touch-action: none; }
.tpad .base { position: absolute; width: ${STICK_R * 2 + 20}px; height: ${STICK_R * 2 + 20}px; margin: -${STICK_R + 10}px 0 0 -${STICK_R + 10}px;
  border-radius: 50%; background: rgba(255,255,255,0.22); border: 4px solid rgba(255,255,255,0.7); box-shadow: 0 4px 0 rgba(59,42,92,0.25); pointer-events: none; }
.tpad .knob { position: absolute; left: 50%; top: 50%; width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%;
  background: #fff; box-shadow: 0 4px 0 #c3b8e6, 0 6px 14px rgba(59,42,92,0.25); }
.tpad .base.idle { opacity: 0.5; }
.tpad .btns { position: absolute; right: calc(16px + env(safe-area-inset-right)); bottom: calc(16px + env(safe-area-inset-bottom));
  width: 230px; height: 210px; pointer-events: none; }
.tpad .tb { position: absolute; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-direction: column;
  color: var(--ink, #3b2a5c); font-size: 17px; letter-spacing: 0.04em; pointer-events: auto; touch-action: none;
  background: #fff; box-shadow: 0 6px 0 #c3b8e6, 0 10px 20px rgba(59,42,92,0.2); }
.tpad .tb.down { transform: translateY(4px); box-shadow: 0 2px 0 #c3b8e6; }
.tpad .tb.off { display: none; }
.tpad .tb .n { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 14px; }
.tpad .tb.empty { opacity: 0.4; }
.tpad .jump { right: 0; bottom: 0; width: 104px; height: 104px; background: var(--teal, #23f0c7); box-shadow: 0 6px 0 #14a88b, 0 10px 20px rgba(59,42,92,0.2); font-size: 20px; }
.tpad .jump.down { box-shadow: 0 2px 0 #14a88b; }
.tpad .a1 { right: 120px; bottom: 6px; width: 86px; height: 86px; background: #fff2a8; }
.tpad .a1.slash { right: 116px; bottom: 0; width: 104px; height: 104px; background: var(--red, #ef767a); color: #fff; box-shadow: 0 6px 0 #b04a4e, 0 10px 20px rgba(59,42,92,0.2); font-size: 20px; }
.tpad .a1.next { background: #fff; }
.tpad .a2 { right: 10px; bottom: 120px; width: 86px; height: 86px; background: #8fe3ff; }
.tpad .menu { position: absolute; left: calc(12px + env(safe-area-inset-left)); top: calc(12px + env(safe-area-inset-top)); display: flex; gap: 8px; pointer-events: none; }
.tpad .menu .tb { position: static; width: 46px; height: 46px; font-size: 20px; box-shadow: 0 4px 0 #c3b8e6; }
@media (max-width: 640px) { html.touch .hud .teams { top: calc(70px + env(safe-area-inset-top)); } }
`;

const root = document.createElement('div');
root.className = 'tpad';
root.innerHTML = `
  <div class="zone"><div class="base idle"><div class="knob"></div></div></div>
  <div class="btns">
    <div class="tb jump" data-b="jump">JUMP</div>
    <div class="tb a1" data-b="a1"></div>
    <div class="tb a2" data-b="a2"></div>
  </div>
  <div class="menu"><div class="tb" data-b="board">🏆</div><div class="tb" data-b="mute">🔊</div></div>`;
const zone = root.querySelector<HTMLElement>('.zone')!;
const base = root.querySelector<HTMLElement>('.base')!;
const knob = root.querySelector<HTMLElement>('.knob')!;
const btn = (b: string) => root.querySelector<HTMLElement>(`[data-b=${b}]`)!;
const a1 = btn('a1'), a2 = btn('a2'), jump = btn('jump'), mute = btn('mute');

let stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
const held = new Map<number, string>(); // pointerId → button
let lastHud = '';

function setTouch(on: boolean): void {
  document.documentElement.classList.toggle('touch', on);
}
export function usingTouch(): boolean {
  return document.documentElement.classList.contains('touch');
}

// ── Stick ─────────────────────────────────────────────────────────────────
function placeBase(x: number, y: number): void {
  base.style.left = `${x}px`;
  base.style.top = `${y}px`;
}
function restStick(): void {
  stick = null;
  base.classList.add('idle');
  knob.style.transform = '';
  base.style.left = `min(150px, max(${STICK_R + 30}px, 50%))`;
  base.style.top = `calc(100% - ${STICK_R + 50}px - env(safe-area-inset-bottom))`;
}

zone.addEventListener('pointerdown', e => {
  if (stick) return;
  zone.setPointerCapture(e.pointerId);
  const r = zone.getBoundingClientRect();
  stick = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, x: 0, y: 0 };
  base.classList.remove('idle');
  placeBase(stick.ox, stick.oy);
});
zone.addEventListener('pointermove', e => {
  if (!stick || e.pointerId !== stick.id) return;
  const r = zone.getBoundingClientRect();
  let dx = e.clientX - r.left - stick.ox, dy = e.clientY - r.top - stick.oy;
  const d = Math.hypot(dx, dy);
  // Dragging past the rim drags the stick along, so it never "runs out"
  if (d > STICK_R) {
    stick.ox += dx * (1 - STICK_R / d);
    stick.oy += dy * (1 - STICK_R / d);
    dx *= STICK_R / d; dy *= STICK_R / d;
    placeBase(stick.ox, stick.oy);
  }
  stick.x = dx; stick.y = dy;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
});
const endStick = (e: PointerEvent) => { if (stick && e.pointerId === stick.id) restStick(); };
zone.addEventListener('pointerup', endStick);
zone.addEventListener('pointercancel', endStick);
zone.addEventListener('lostpointercapture', endStick);

// ── Buttons ───────────────────────────────────────────────────────────────
for (const el of root.querySelectorAll<HTMLElement>('.tb')) {
  const b = el.dataset.b!;
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    held.set(e.pointerId, b);
    el.classList.add('down');
    if (b === 'mute') { setMuted(!isMuted()); mute.textContent = isMuted() ? '🔇' : '🔊'; }
  });
  const up = (e: PointerEvent) => {
    if (!held.delete(e.pointerId)) return;
    if (![...held.values()].includes(b)) el.classList.remove('down');
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
}
root.addEventListener('contextmenu', e => e.preventDefault());

const isHeld = (b: string) => [...held.values()].includes(b);

/** Buttons and stick as sim input, or null when no finger is on the controls. */
export function readTouch(): { mx: number; mz: number; b: number } | null {
  if (!root.classList.contains('on') || (!stick && held.size === 0)) return null;
  let mx = 0, mz = 0, b = 0;
  if (stick) {
    const d = Math.hypot(stick.x, stick.y) / (STICK_R * 0.85);
    if (d > DEADZONE) {
      const k = Math.min(1, (d - DEADZONE) / (1 - DEADZONE)) / d / (STICK_R * 0.85);
      mx = stick.x * k; mz = stick.y * k; // screen right = +x, screen down = +z (toward the camera)
    }
  }
  if (isHeld('jump')) b |= BTN_JUMP;
  if (isHeld('a1')) b |= BTN_ACTION | BTN_FLASH;
  if (isHeld('a2')) b |= BTN_ACTION | BTN_FROST;
  return { mx, mz, b };
}

export function touchBoardHeld(): boolean {
  return isHeld('board');
}

/** Called every frame: null outside a match hides the controls. */
export function updateTouch(s: TouchHud | null): void {
  const key = s ? JSON.stringify(s) : '';
  if (key === lastHud) return;
  lastHud = key;
  const wasOn = root.classList.contains('on');
  root.classList.toggle('on', !!s);
  if (s && !wasOn) restStick();
  if (!s) { held.clear(); restStick(); for (const el of root.querySelectorAll('.down')) el.classList.remove('down'); return; }
  const runner = s.alive && s.role === 'runner', tagger = s.alive && s.role === 'tagger';
  zone.style.display = s.alive ? '' : 'none';
  if (!s.alive) restStick();
  jump.classList.toggle('off', !s.alive);
  a1.className = `tb a1 ${isHeld('a1') ? 'down' : ''} ${tagger ? 'slash' : ''} ${s.spectating && !s.alive ? 'next' : ''} ${runner && !s.nades.flash ? 'empty' : ''} ${!s.alive && !s.spectating ? 'off' : ''}`;
  a1.innerHTML = runner ? `FLASH<span class="n">×${s.nades.flash}</span>` : tagger ? 'SLASH' : 'NEXT';
  a2.className = `tb a2 ${isHeld('a2') ? 'down' : ''} ${runner ? '' : 'off'} ${runner && !s.nades.frost ? 'empty' : ''}`;
  a2.innerHTML = `FROST<span class="n">×${s.nades.frost}</span>`;
  for (const [id, b] of held) if (root.querySelector(`[data-b=${b}]`)!.classList.contains('off')) held.delete(id);
}

// ── Touch vs keyboard/gamepad ─────────────────────────────────────────────
window.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || e.pointerType === 'pen') setTouch(true);
}, { capture: true });
window.addEventListener('keydown', e => {
  if (!(e.target instanceof HTMLInputElement)) setTouch(false);
}, { capture: true });
/** input.ts calls this when a gamepad is in use. */
export function gamepadUsed(): void {
  if (usingTouch()) setTouch(false);
}

// Fullscreen on a menu button tap (needs a user gesture). Skipped once installed to the home
// screen, and on iPhone Safari, which only fullscreens video.
window.addEventListener('click', e => {
  if (!usingTouch() || !(e.target instanceof HTMLElement) || !e.target.closest('.btn')) return;
  const d = document as Document & { webkitFullscreenElement?: Element };
  if (d.fullscreenElement || d.webkitFullscreenElement || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  else el.webkitRequestFullscreen?.();
});

// iOS Safari ignores user-scalable=no for pinch zoom (body's touch-action stops double-tap zoom)
document.addEventListener('gesturestart', e => e.preventDefault());

const style = document.createElement('style');
style.textContent = CSS;
document.head.appendChild(style);
document.body.appendChild(root);
restStick();
