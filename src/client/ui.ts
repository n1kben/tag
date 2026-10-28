// DOM UI in Boomerang Fu's menu style: chunky outlined display type, candy pills, sky blues.
import * as THREE from 'three';
import { Character } from './characters';
import { CHARACTERS, MAX_HP, NADE_KINDS, type NadeKind } from '../shared/constants';
import type { LobbyPlayer, Phase, Standing } from '../shared/protocol';
import type { Role } from '../shared/sim';

const CSS = `
:root {
  --ink: #3b2a5c; --pink: #f0408f; --yellow: #ffd23f; --teal: #23f0c7; --red: #ef767a;
  --sky1: #4fa9f2; --sky2: #9fd5ff; --card: #ffffff; --soft: #efeaff;
}
.ui { position: fixed; inset: 0; pointer-events: none; font-family: 'Fredoka', system-ui, sans-serif; color: var(--ink); z-index: 10; }
.ui * { pointer-events: auto; }
.ui .pe-none, .ui .pe-none * { pointer-events: none; }
.screen { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; }
.screen.on { display: flex; }
.display { font-family: 'Lilita One', 'Fredoka', sans-serif; letter-spacing: 0.02em; color: #fff;
  -webkit-text-stroke: 0.09em var(--ink); paint-order: stroke fill; text-shadow: 0 0.09em 0 var(--ink); }
.sky { background: linear-gradient(180deg, var(--sky1) 0%, var(--sky2) 55%, rgba(159,213,255,0.0) 100%); }
.clouds { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.cloud { position: absolute; background: #fff; border-radius: 999px; opacity: 0.95; animation: drift 60s linear infinite; }
.cloud::before, .cloud::after { content: ''; position: absolute; background: #fff; border-radius: 50%; }
.cloud::before { width: 55%; height: 160%; left: 12%; bottom: 20%; }
.cloud::after { width: 40%; height: 130%; right: 14%; bottom: 25%; }
@keyframes drift { from { transform: translateX(-30vw); } to { transform: translateX(130vw); } }
.logo { text-align: center; line-height: 0.85; margin-bottom: 18px; position: relative; }
.logo .l1 { font-size: clamp(54px, 10vw, 112px); color: var(--yellow); }
.logo .l2 { font-size: clamp(64px, 12vw, 136px); color: #ff8a3d; display: inline-block; transform: rotate(-4deg); }
.logo .lines { position: absolute; left: 6%; top: 72%; width: 26%; height: 10px; border-top: 6px solid var(--ink); border-bottom: 6px solid var(--ink); border-radius: 4px; opacity: 0.85; }
.ribbon { display: inline-block; background: var(--pink); color: #fff; font-family: 'Lilita One'; font-size: 24px; padding: 6px 26px;
  border-radius: 10px; box-shadow: 0 5px 0 #a8255f; transform: rotate(-2deg); margin-bottom: 30px; letter-spacing: 0.06em; }
.btn { font-family: 'Lilita One', sans-serif; font-size: 22px; letter-spacing: 0.04em; border: none; cursor: pointer; color: var(--ink);
  background: #fff; padding: 14px 30px; border-radius: 999px; box-shadow: 0 6px 0 #c3b8e6, 0 10px 24px rgba(59,42,92,0.18);
  transition: transform 0.08s, box-shadow 0.08s; min-width: 240px; }
.btn:hover { transform: translateY(-2px) scale(1.03); }
.btn:active { transform: translateY(4px); box-shadow: 0 2px 0 #c3b8e6; }
.btn.pink { background: var(--pink); color: #fff; box-shadow: 0 6px 0 #a8255f, 0 10px 24px rgba(240,64,143,0.35); }
.btn.teal { background: var(--teal); box-shadow: 0 6px 0 #14a88b, 0 10px 24px rgba(35,240,199,0.3); }
.btn.yellow { background: var(--yellow); box-shadow: 0 6px 0 #c99d12; }
.btn.small { font-size: 16px; padding: 9px 18px; min-width: 0; box-shadow: 0 4px 0 #c3b8e6; }
.btn:disabled { opacity: 0.5; cursor: default; transform: none; }
.col { display: flex; flex-direction: column; gap: 16px; align-items: center; }
.row { display: flex; gap: 12px; align-items: center; justify-content: center; flex-wrap: wrap; }
.code-in { font-family: 'Lilita One'; font-size: 22px; width: 150px; text-align: center; text-transform: uppercase; letter-spacing: 0.2em;
  border: 4px solid #fff; background: rgba(255,255,255,0.75); color: var(--ink); border-radius: 999px; padding: 10px 14px; outline: none; }
.code-in:focus { border-color: var(--yellow); }
.status { min-height: 1.4em; color: #fff; font-weight: 600; text-shadow: 0 2px 0 var(--ink); }
.hint { position: absolute; bottom: 18px; left: 0; right: 0; text-align: center; color: #fff; font-weight: 600; text-shadow: 0 2px 0 rgba(59,42,92,0.6); font-size: 15px; }
kbd { background: #fff; color: var(--ink); border-radius: 6px; padding: 1px 7px; box-shadow: 0 2px 0 #c3b8e6; font-family: 'Fredoka'; font-weight: 700; font-size: 13px; }

.lobby { background: rgba(255,255,255,0.0); }
.panel { background: rgba(255,255,255,0.92); border-radius: 28px; padding: 22px 26px 26px; box-shadow: 0 10px 0 #c3b8e6, 0 24px 60px rgba(59,42,92,0.25);
  max-width: min(980px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; }
.room-code { font-family: 'Lilita One'; font-size: 44px; letter-spacing: 0.18em; color: var(--pink); cursor: pointer; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; margin: 16px 0 20px; min-width: min(760px, calc(100vw - 80px)); }
.card { background: var(--soft); border-radius: 20px; padding: 10px 10px 12px; text-align: center; position: relative; border: 4px solid transparent; }
.card.me { border-color: var(--yellow); background: #fff8dc; }
.card.ready { box-shadow: inset 0 0 0 3px var(--teal); }
.card img { width: 110px; height: 110px; object-fit: contain; display: block; margin: 0 auto; }
.card .nm { font-weight: 700; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .tag { position: absolute; top: 8px; right: 8px; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #fff; }
.card .tag.rdy { background: var(--teal); }
.card .arrows { display: flex; justify-content: space-between; position: absolute; top: 50px; left: 4px; right: 4px; }
.card .arrows button { width: 30px; height: 30px; border-radius: 50%; border: none; background: #fff; font-weight: 800; color: var(--ink); cursor: pointer; box-shadow: 0 3px 0 #c3b8e6; }
.name-in { font-family: 'Fredoka'; font-weight: 600; font-size: 16px; border: 3px solid #d9d0f5; border-radius: 12px; padding: 4px 8px; width: 100%; text-align: center; outline: none; color: var(--ink); }
.name-in:focus { border-color: var(--yellow); }
.results { background: #fff8dc; border-radius: 16px; padding: 10px 16px; margin-top: 8px; font-weight: 600; }

.hud { position: fixed; inset: 0; pointer-events: none; display: none; }
.hud.on { display: block; }
.hud * { pointer-events: none; }
.timer { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); background: #fff; border-radius: 999px; padding: 4px 26px 6px;
  font-family: 'Lilita One'; font-size: 34px; box-shadow: 0 5px 0 #c3b8e6; min-width: 120px; text-align: center; }
.timer.hide { background: var(--yellow); box-shadow: 0 5px 0 #c99d12; }
.timer.low { color: var(--pink); }
.teams { position: absolute; top: 22px; left: 50%; transform: translateX(-50%); width: 520px; display: flex; justify-content: space-between; }
.team { display: flex; gap: 5px; align-items: center; }
.pip { width: 18px; height: 18px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 2px 0 rgba(59,42,92,0.3); }
.pip.dead { opacity: 0.3; }
.role-chip { position: absolute; top: 16px; left: 16px; font-family: 'Lilita One'; font-size: 20px; padding: 6px 16px; border-radius: 999px; color: #fff; box-shadow: 0 4px 0 rgba(59,42,92,0.3); }
.hp { position: absolute; top: 58px; left: 18px; display: flex; gap: 4px; }
.heart { font-size: 22px; filter: drop-shadow(0 2px 0 rgba(59,42,92,0.4)); }
.inv { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; }
.slot { background: #fff; border-radius: 18px; padding: 6px 12px; min-width: 74px; text-align: center; box-shadow: 0 5px 0 #c3b8e6; opacity: 0.55; transition: transform 0.1s; }
.slot.sel { opacity: 1; transform: translateY(-6px) scale(1.08); box-shadow: 0 5px 0 var(--pink); }
.slot.empty { opacity: 0.25; }
.slot .ic { width: 26px; height: 26px; border-radius: 50%; margin: 2px auto; border: 3px solid var(--ink); }
.slot .lb { font-weight: 700; font-size: 13px; }
.keys { position: absolute; bottom: 16px; left: 16px; color: #fff; font-weight: 600; font-size: 13px; text-shadow: 0 2px 0 rgba(59,42,92,0.55); line-height: 1.9; }
.feed { position: absolute; top: 14px; right: 16px; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.feed div { background: rgba(255,255,255,0.92); border-radius: 999px; padding: 4px 14px; font-weight: 700; font-size: 14px; box-shadow: 0 3px 0 #c3b8e6; animation: pop 0.25s; }
.banner { position: absolute; left: 0; right: 0; top: 30%; text-align: center; animation: slam 0.45s cubic-bezier(.2,1.6,.4,1); }
.banner .big { font-size: clamp(48px, 9vw, 104px); line-height: 1; }
.banner .sub { font-family: 'Lilita One'; font-size: 26px; color: #fff; text-shadow: 0 3px 0 var(--ink); margin-top: 8px; }
@keyframes slam { from { transform: scale(2.4) rotate(-6deg); opacity: 0; } to { transform: scale(1) rotate(0); opacity: 1; } }
@keyframes pop { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.blackout { position: absolute; inset: 0; background: #1d1830; display: flex; align-items: center; justify-content: center; flex-direction: column; opacity: 0; transition: opacity 0.3s; }
.blackout.on { opacity: 1; }
.blackout .n { font-family: 'Lilita One'; font-size: 160px; color: var(--yellow); }
.blackout .t { font-family: 'Lilita One'; font-size: 30px; color: #fff; }
.whiteout { position: absolute; inset: 0; background: #fffef4; opacity: 0; }
.frostout { position: absolute; inset: 0; box-shadow: inset 0 0 160px 40px rgba(143,227,255,0.85); opacity: 0; transition: opacity 0.2s; }
.spect { position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%); background: rgba(59,42,92,0.75); color: #fff; padding: 6px 18px; border-radius: 999px; font-weight: 700; }
.board { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
.board table { border-collapse: collapse; min-width: 380px; }
.board td, .board th { padding: 6px 12px; text-align: left; font-weight: 600; }
.board th { font-family: 'Lilita One'; font-weight: 400; color: #8a7bb5; }
.board tr.me td { color: var(--pink); }
.board img { width: 30px; height: 30px; vertical-align: middle; }
.podium { display: flex; align-items: flex-end; gap: 16px; margin: 20px 0; }
.podium .p { text-align: center; }
.podium .p img { width: 120px; height: 120px; }
.podium .block { border-radius: 16px 16px 0 0; width: 140px; font-family: 'Lilita One'; font-size: 40px; color: #fff; padding-top: 6px; }
.label { position: absolute; transform: translate(-50%, -100%); white-space: nowrap; pointer-events: none; text-align: center; }
.label .tagp { display: inline-block; font-weight: 700; font-size: 12px; color: #fff; padding: 1px 8px 2px; border-radius: 999px;
  box-shadow: 0 2px 0 rgba(59,42,92,0.35); }
.label .tagp::after { content: ''; position: absolute; left: 50%; bottom: -5px; transform: translateX(-50%); border: 5px solid transparent;
  border-top-color: inherit; border-bottom: 0; }
.label .bar { height: 5px; border-radius: 3px; background: rgba(59,42,92,0.4); margin: 2px auto 0; width: 34px; overflow: hidden; }
.label .bar i { display: block; height: 100%; background: var(--teal); }
.debug { position: fixed; top: 8px; right: 8px; background: rgba(0,0,0,0.6); color: #9f9; font: 12px monospace; padding: 6px 10px; border-radius: 6px; display: none; z-index: 30; pointer-events: none; }
.mute { position: fixed; bottom: 14px; right: 14px; z-index: 20; }
@media (max-width: 640px) { .teams { width: 92vw; } .keys { display: none; } .btn { min-width: 200px; } }
`;

const NADE_LABEL: Record<NadeKind, string> = { flash: 'Flash', frost: 'Frost', smoke: 'Smoke', boom: 'Boom' };
const NADE_CSS: Record<NadeKind, string> = { flash: '#fff2a8', frost: '#8fe3ff', smoke: '#c9cce6', boom: '#ff6a4a' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ── Portraits rendered from the real 3D characters ────────────────────────
const portraitCache = new Map<number, string>();
let portraitRenderer: THREE.WebGLRenderer | null = null;

export function portrait(character: number): string {
  if (portraitCache.has(character)) return portraitCache.get(character)!;
  try {
    if (!portraitRenderer) {
      portraitRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      portraitRenderer.setSize(220, 220);
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa2e0, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.4);
    sun.position.set(-2, 4, 4);
    scene.add(sun);
    const ch = new Character(character);
    ch.setRingVisible(false);
    ch.update(0.016, { speed: 0, vy: 0, grounded: true, lunge: 0, aiming: 0, frozen: false, chilled: false });
    ch.root.rotation.y = -0.35;
    scene.add(ch.root);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    cam.position.set(0, 1.25, 3.1);
    cam.lookAt(0, 0.55, 0);
    portraitRenderer.render(scene, cam);
    const url = portraitRenderer.domElement.toDataURL('image/png');
    portraitCache.set(character, url);
    return url;
  } catch {
    return '';
  }
}

export interface TitleHandlers { practice(): void; create(): void; join(code: string): void }
export interface LobbyHandlers {
  rename(name: string): void;
  character(delta: number): void;
  ready(): void;
  addBot(): void;
  removeBot(): void;
  leave(): void;
}

export interface HudState {
  phase: Phase;
  timeLeft: number;
  role: Role;
  alive: boolean;
  hp: number;
  frozen: number;
  blind: number;
  nades: Record<NadeKind, number>;
  nadeSel: NadeKind;
  teams: { id: number; role: Role; alive: boolean }[];
  spectating: string | null;
}

export class UI {
  readonly root = el('div', 'ui');
  private title = el('div', 'screen sky');
  private lobby = el('div', 'screen lobby');
  private end = el('div', 'screen');
  private hud = el('div', 'hud');
  private labels = el('div', 'pe-none');
  private debugEl = el('div', 'debug');
  private titleStatus!: HTMLDivElement;
  private feed = el('div', 'feed');
  private bannerEl = el('div', 'pe-none');
  private blackout = el('div', 'blackout', '<div class="n"></div><div class="t"></div>');
  private whiteout = el('div', 'whiteout');
  private frostout = el('div', 'frostout');
  private board = el('div', 'board panel');
  private lobbyHandlers: LobbyHandlers | null = null;
  private labelEls = new Map<number, HTMLDivElement>();
  private names = new Map<number, { name: string; character: number }>();
  private lastHud = '';

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.append(this.labels, this.hud, this.title, this.lobby, this.end, this.debugEl);
    document.body.appendChild(this.root);

    this.hud.append(this.blackout, this.whiteout, this.frostout, this.feed, this.bannerEl, this.board);
    this.board.style.display = 'none';
  }

  setNames(players: LobbyPlayer[]): void {
    for (const p of players) this.names.set(p.id, { name: p.name, character: p.character });
  }

  nameOf(id: number | null): string {
    return id === null ? '' : this.names.get(id)?.name ?? `#${id}`;
  }

  // ── Title ───────────────────────────────────────────────────────────────
  showTitle(h: TitleHandlers): void {
    this.hideAll();
    this.title.innerHTML = '';
    const clouds = el('div', 'clouds');
    for (let i = 0; i < 6; i++) {
      const c = el('div', 'cloud');
      const w = 120 + Math.random() * 160;
      Object.assign(c.style, { width: `${w}px`, height: `${w * 0.32}px`, top: `${4 + Math.random() * 34}%`, animationDelay: `${-Math.random() * 60}s`, animationDuration: `${50 + Math.random() * 40}s` });
      clouds.appendChild(c);
    }
    const box = el('div', 'col');
    box.style.position = 'relative';
    box.innerHTML = `
      <div class="logo"><div class="lines"></div><div class="display l1">ROOFTOP</div><div class="display l2">FU!</div></div>
      <div class="ribbon">HIDE 'N SEEK</div>
      <button class="btn pink" data-a="practice">PLAY VS BOTS</button>
      <button class="btn" data-a="create">CREATE ROOM</button>
      <div class="row"><input class="code-in" maxlength="5" placeholder="CODE" /><button class="btn teal small" data-a="join">JOIN</button></div>
      <div class="status"></div>`;
    this.titleStatus = box.querySelector('.status')!;
    const code = box.querySelector('input')!;
    box.querySelector('[data-a=practice]')!.addEventListener('click', () => h.practice());
    box.querySelector('[data-a=create]')!.addEventListener('click', () => h.create());
    const join = () => {
      const c = code.value.trim().toUpperCase();
      if (c.length < 4) { this.setStatus('Enter a room code'); return; }
      h.join(c);
    };
    box.querySelector('[data-a=join]')!.addEventListener('click', join);
    code.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
    const hint = el('div', 'hint', `Hiders: run, jump the gaps, throw grenades · Seekers: catch them and slash · <kbd>WASD</kbd> move <kbd>Space</kbd> jump <kbd>Enter</kbd> slash / throw <kbd>Q</kbd> switch grenade · gamepad works too`);
    this.title.append(clouds, box, hint);
    this.title.classList.add('on');
  }

  setStatus(text: string): void {
    if (this.titleStatus) this.titleStatus.textContent = text;
  }

  // ── Lobby ───────────────────────────────────────────────────────────────
  showLobby(h: LobbyHandlers): void {
    this.hideAll();
    this.lobbyHandlers = h;
    this.lobby.classList.add('on');
  }

  updateLobby(roomId: string, players: LobbyPlayer[], myId: number, inMatch: boolean, last?: Standing[]): void {
    this.setNames(players);
    if (!this.lobby.classList.contains('on') || !this.lobbyHandlers) return;
    const h = this.lobbyHandlers;
    const me = players.find(p => p.id === myId);
    const focused = document.activeElement instanceof HTMLInputElement ? document.activeElement.value : null;
    const results = last?.length
      ? `<div class="results">🏆 Last match: <b>${esc(last[0].name)}</b> won with ${last[0].score} pts</div>` : '';
    this.lobby.innerHTML = `
      <div class="panel">
        <div class="row" style="justify-content:space-between">
          <div><div style="font-weight:700;color:#8a7bb5">ROOM CODE · click to copy link</div><div class="room-code" title="Copy invite link">${esc(roomId)}</div></div>
          <div class="row"><button class="btn small" data-a="add">+ BOT</button><button class="btn small" data-a="rm">− BOT</button><button class="btn small" data-a="leave">LEAVE</button></div>
        </div>
        ${results}
        <div class="cards">${players.map(p => `
          <div class="card ${p.id === myId ? 'me' : ''} ${p.ready ? 'ready' : ''}">
            ${p.bot ? '<div class="tag">BOT</div>' : p.ready ? '<div class="tag rdy">READY</div>' : ''}
            <img src="${portrait(p.character)}" alt="${CHARACTERS[p.character]}" />
            ${p.id === myId ? `<div class="arrows"><button data-a="prev">‹</button><button data-a="next">›</button></div>
              <input class="name-in" maxlength="16" value="${esc(p.name)}" />` : `<div class="nm">${esc(p.name)}</div>`}
          </div>`).join('')}</div>
        <div class="row">
          ${inMatch ? '<div class="status" style="color:#8a7bb5;text-shadow:none">Match in progress — you\'ll join next round</div>'
            : `<button class="btn ${me?.ready ? '' : 'pink'}" data-a="ready">${me?.ready ? 'CANCEL' : players.length < 2 ? 'ADD A BOT TO START' : "I'M READY!"}</button>`}
        </div>
      </div>`;
    const q = (a: string) => this.lobby.querySelector(`[data-a=${a}]`);
    q('add')?.addEventListener('click', () => h.addBot());
    q('rm')?.addEventListener('click', () => h.removeBot());
    q('leave')?.addEventListener('click', () => h.leave());
    q('ready')?.addEventListener('click', () => h.ready());
    q('prev')?.addEventListener('click', () => h.character(-1));
    q('next')?.addEventListener('click', () => h.character(1));
    this.lobby.querySelector('.room-code')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#${roomId}`);
    });
    const nameIn = this.lobby.querySelector<HTMLInputElement>('.name-in');
    if (nameIn) {
      if (focused !== null) { nameIn.value = focused; nameIn.focus(); }
      let t: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        if (t) clearTimeout(t);
        t = null;
        if (nameIn.value.trim() && nameIn.value.trim() !== me?.name) h.rename(nameIn.value);
      };
      nameIn.addEventListener('input', () => {
        if (t) clearTimeout(t);
        t = setTimeout(flush, 400);
      });
      // Clicking elsewhere re-renders the lobby, so don't lose a half-typed name
      nameIn.addEventListener('blur', flush);
      nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') nameIn.blur(); });
    }
  }

  // ── In game ─────────────────────────────────────────────────────────────
  showHud(): void {
    this.hideAll();
    this.hud.classList.add('on');
  }

  updateHud(s: HudState): void {
    const key = JSON.stringify({ ...s, timeLeft: Math.ceil(s.timeLeft), frozen: s.frozen > 0, blind: 0 });
    // Overlays update every frame; the rest only when something visible changed
    const seekerHiding = s.phase === 'hide' && s.role === 'seeker' && s.alive;
    this.blackout.classList.toggle('on', seekerHiding);
    if (seekerHiding) {
      (this.blackout.firstChild as HTMLElement).textContent = String(Math.max(1, Math.ceil(s.timeLeft)));
      (this.blackout.lastChild as HTMLElement).textContent = 'HIDERS ARE HIDING… NO PEEKING';
    }
    this.whiteout.style.opacity = String(Math.min(1, s.blind / 1.6));
    this.frostout.style.opacity = s.frozen > 0 ? '1' : '0';
    if (key === this.lastHud) return;
    this.lastHud = key;

    for (const old of this.hud.querySelectorAll('.dyn')) old.remove();
    const t = Math.ceil(s.timeLeft);
    const timeStr = s.phase === 'hide' ? `HIDE ${t}` : s.phase === 'end' ? '—' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const timer = el('div', `dyn timer ${s.phase === 'hide' ? 'hide' : ''} ${s.phase === 'seek' && t <= 15 ? 'low' : ''}`, timeStr);
    const pips = (role: Role) => s.teams.filter(p => p.role === role)
      .map(p => `<div class="pip ${p.alive ? '' : 'dead'}" style="background:${role === 'hider' ? 'var(--teal)' : 'var(--red)'}"></div>`).join('');
    const teams = el('div', 'dyn teams', `<div class="team">${pips('hider')}</div><div class="team">${pips('seeker')}</div>`);
    const chip = el('div', 'dyn role-chip', s.role === 'hider' ? 'HIDER' : 'SEEKER');
    chip.style.background = s.role === 'hider' ? '#14bfa0' : '#e0505a';
    this.hud.append(timer, teams, chip);
    if (s.alive) {
      const hearts = Math.ceil(s.hp / (MAX_HP / 2));
      this.hud.append(el('div', 'dyn hp', [0, 1].map(i => `<span class="heart">${i < hearts ? '❤️' : '🤍'}</span>`).join('')));
    }
    if (s.alive && s.role === 'hider') {
      const inv = el('div', 'dyn inv', NADE_KINDS.map(k => `
        <div class="slot ${k === s.nadeSel && s.nades[k] > 0 ? 'sel' : ''} ${s.nades[k] ? '' : 'empty'}">
          <div class="ic" style="background:${NADE_CSS[k]}"></div><div class="lb">${NADE_LABEL[k]} ×${s.nades[k]}</div></div>`).join(''));
      this.hud.append(inv);
      this.hud.append(el('div', 'dyn keys', '<kbd>Enter</kbd> hold &amp; release to throw · <kbd>Q</kbd> switch grenade<br><kbd>Space</kbd> jump (hold = higher) — chain hops to go faster'));
    } else if (s.alive && s.role === 'seeker') {
      this.hud.append(el('div', 'dyn keys', `<kbd>Enter</kbd> slash (from behind = instant)<br><kbd>Space</kbd> jump (hold = higher)`));
    }
    if (s.spectating) this.hud.append(el('div', 'dyn spect', `Spectating ${esc(s.spectating)} · <kbd>Enter</kbd> next`));
  }

  banner(big: string, sub = '', color = '#ffd23f', ms = 1800): void {
    const b = el('div', 'banner', `<div class="display big" style="color:${color}">${esc(big)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}`);
    this.bannerEl.innerHTML = '';
    this.bannerEl.appendChild(b);
    setTimeout(() => { if (b.parentElement) b.remove(); }, ms);
  }

  killfeed(html: string): void {
    const d = el('div', '', html);
    this.feed.prepend(d);
    while (this.feed.children.length > 5) this.feed.lastChild!.remove();
    setTimeout(() => d.remove(), 5000);
  }

  showBoard(show: boolean, standings: Standing[], myId: number): void {
    this.board.style.display = show ? 'block' : 'none';
    if (!show) return;
    this.board.innerHTML = `<table><tr><th></th><th>PLAYER</th><th>PTS</th><th>KILLS</th><th>SURVIVED</th></tr>${standings.map(s => `
      <tr class="${s.id === myId ? 'me' : ''}"><td><img src="${portrait(s.character)}" /></td><td>${esc(s.name)}</td><td>${s.score}</td><td>${s.kills}</td><td>${s.survived}</td></tr>`).join('')}</table>`;
  }

  showMatchEnd(standings: Standing[], myId: number, back: () => void): void {
    this.hideAll();
    const top = standings.slice(0, 3);
    const order = [1, 0, 2].filter(i => top[i]);
    const heights = [150, 110, 80];
    const colors = ['#ffd23f', '#c3b8e6', '#f0a070'];
    this.end.innerHTML = `
      <div class="panel col" style="background:rgba(255,255,255,0.95)">
        <div class="display" style="font-size:64px;color:var(--yellow)">${esc(top[0]?.name ?? '')} WINS!</div>
        <div class="podium">${order.map(i => `
          <div class="p"><img src="${portrait(top[i].character)}" /><div style="font-weight:700">${esc(top[i].name)}</div>
            <div class="block" style="height:${heights[i]}px;background:${colors[i]}">${i + 1}</div><div style="font-weight:700">${top[i].score} pts</div></div>`).join('')}</div>
        <div style="font-weight:600;color:#8a7bb5">${standings.map(s => `${s.id === myId ? '<b style="color:var(--pink)">' : ''}${esc(s.name)} ${s.score}${s.id === myId ? '</b>' : ''}`).join(' · ')}</div>
        <button class="btn pink" data-a="back">BACK TO LOBBY</button>
      </div>`;
    this.end.querySelector('[data-a=back]')!.addEventListener('click', back);
    this.end.classList.add('on');
  }

  // ── Floating name labels ────────────────────────────────────────────────
  label(id: number, x: number, y: number, text: string, color: string, hp: number | null): void {
    let e = this.labelEls.get(id);
    if (!e) {
      e = el('div', 'label');
      this.labels.appendChild(e);
      this.labelEls.set(id, e);
    }
    const html = `<span class="tagp" style="background:${color};border-color:${color}">${esc(text)}</span>${hp !== null && hp < MAX_HP ? `<div class="bar"><i style="width:${Math.max(0, hp)}%;background:${hp > 50 ? 'var(--teal)' : 'var(--pink)'}"></i></div>` : ''}`;
    if (e.dataset.h !== html) { e.innerHTML = html; e.dataset.h = html; }
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
    e.style.display = 'block';
  }

  hideLabelsExcept(ids: Set<number>): void {
    for (const [id, e] of this.labelEls) if (!ids.has(id)) e.style.display = 'none';
  }

  debug(text: string | null): void {
    this.debugEl.style.display = text === null ? 'none' : 'block';
    if (text !== null) this.debugEl.textContent = text;
  }

  hideAll(): void {
    for (const s of [this.title, this.lobby, this.end]) s.classList.remove('on');
    this.hud.classList.remove('on');
    this.board.style.display = 'none';
    this.hideLabelsExcept(new Set());
  }
}

