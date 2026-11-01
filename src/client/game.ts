// Client glue: lobby flow, fixed-step prediction + reconciliation for the local players,
// snapshot interpolation for everyone else, and turning server events into juice.
// Up to four local players share the screen (split screen). Each is a seat with its own connection,
// so to the server they're ordinary players; seat 1's connection also drives the lobby, the match
// lifecycle and everyone else's bodies, and the other seats only follow their own player.
import * as THREE from 'three';
import { createWorld, aimCamera, adaptResolution, setMap, updatePlanks, CAMERA_DIST, type World } from './world';
import { Character, SliceDeath, CHAR_DEFS } from './characters';
import { Fx } from './fx';
import { UI, esc, MAX_SEATS, SEAT_COLORS, type HudState, type Rect, type SeatHud } from './ui';
import { Network } from './net';
import { readInput, isHeld, setInputEnabled, setMenuOwner, setSeatSources, lastDevice, sameSource, sourceTaken, padsFor, rumble, type InputSource } from './input';
import { onTouchMenu, touchBoardHeld, updateTouch } from './touch';
import { onPadPress, padBoardHeld, padPresses, pickPad, pollPad } from './pad';
import { sfx, spatial, setMuted, isMuted } from './audio';
import { BTN_ACTION, BTN_FLASH, BTN_FROST, type Role } from '../shared/sim';
import { ClientNet, lerpAngle } from './netcode';
import { FULL_MAP, mapFor, roofsForPlayers } from '../shared/map';
import { TICK_DT, TICK_RATE, NADE_CHARGE_TIME, COLOR_TAGGER, HEAD_START, type NadeKind } from '../shared/constants';
import type { GameEvent, GameMode, LobbyPlayer, Phase, ServerMessage, Snapshot, Standing } from '../shared/protocol';

type Mode = 'title' | 'lobby' | 'match' | 'end';

const PRACTICE_BOTS = 5; // PLAY VS BOTS: the lobby starts with these
const NO_INPUT = { mx: 0, mz: 0, b: 0 };

/** One local player. */
interface Seat {
  n: number; // 0 = P1
  src: InputSource;
  net: Network;
  cn: ClientNet; // prediction, snapshot buffer, render clock
  id: number; // server player id (-1 until welcomed)
  hud: SeatHud;
  camera: THREE.PerspectiveCamera;
  camTarget: THREE.Vector3;
  rect: Rect;
  aimHeld: number;
  aimKind: NadeKind; // grenade being aimed
  prevAction: boolean;
  spectate: number | null;
}

export function startGame(): void {
  const world: World = createWorld(document.getElementById('app')!);
  const fx = new Fx(world.scene);
  const ui = new UI();
  const seats: Seat[] = [];
  const p1 = addSeat('any');
  const { net, cn } = p1;
  // For the netgraph and browser tests (seat 1)
  (window as unknown as { __net: unknown }).__net = { transport: () => net.transport, stats: cn.stats, delay: () => cn.delay, rtt: () => net.rtt,
    server: () => ({ ack: cn.latest?.ack ?? 0, x: cn.latest?.me?.x ?? 0, z: cn.latest?.me?.z ?? 0, alive: !!cn.latest?.me?.alive, phase: cn.latest?.phase, frozen: cn.latest?.me?.frozen ?? 0, stun: cn.latest?.me?.stun ?? 0 }),
    seats: () => seats.map(s => ({ id: s.id, x: s.cn.latest?.me?.x ?? 0, z: s.cn.latest?.me?.z ?? 0, alive: !!s.cn.latest?.me?.alive })),
  };

  let mode: Mode = 'title';
  let roomId = '';
  let menuSeat: Seat | null = null; // whose in-match menu is open (their player stands still)
  let lobbyPlayers: LobbyPlayer[] = [];
  let lastStandings: Standing[] | undefined;
  let lobbyInMatch = false;
  let lobbyMode: GameMode = 'tag';
  let gameMode: GameMode = 'tag'; // mode of the match being played
  let standings: Standing[] = [];

  // Match state
  const chars = new Map<number, Character>();
  const slices: SliceDeath[] = [];
  const dead = new Set<number>();
  let roles: Record<number, Role> = {};
  let phase: Phase = 'start';
  let timeLeft = 0;

  // Local prediction
  let acc = 0;
  let titleT = 0;
  const overview = new THREE.PerspectiveCamera(world.camera.fov, 1, 1, 200); // the spare quarter of a three-way split

  net.onClose = () => {
    if (mode !== 'title') {
      dropExtraSeats();
      cleanupMatch();
      mode = 'title';
      showTitle();
      ui.setStatus('Disconnected from server');
    }
  };

  // ── Seats ───────────────────────────────────────────────────────────────
  function addSeat(src: InputSource): Seat {
    const seat: Seat = {
      n: seats.length, src, net: null!, cn: new ClientNet(world.map), id: -1, hud: ui.seat(seats.length),
      camera: seats.length ? new THREE.PerspectiveCamera(world.camera.fov, 1, 1, 200) : world.camera,
      camTarget: new THREE.Vector3(0, 1, -3), rect: { x: 0, y: 0, w: 1, h: 1 },
      aimHeld: 0, aimKind: 'flash', prevAction: false, spectate: null,
    };
    seat.net = new Network(msg => handle(seat, msg));
    if (seats.length) seat.net.onClose = () => dropSeat(seat);
    seats.push(seat);
    setSeatSources(seats.map(s => s.src));
    return seat;
  }

  function dropSeat(seat: Seat): void {
    if (seat === p1 || !seats.includes(seat)) return;
    if (menuSeat === seat) closeMenu();
    seat.net.onClose = null;
    seat.net.send({ type: 'leave' });
    seat.net.disconnect();
    fx.hideArc(); // seat numbers shift
    seats.splice(seats.indexOf(seat), 1);
    seats.forEach((s, i) => { s.n = i; s.hud = ui.seat(i); });
    if (seats.length === 1) p1.src = 'any'; // alone again: every device
    setSeatSources(seats.map(s => s.src));
    refreshLobby();
  }

  function dropExtraSeats(): void {
    for (const s of seats.slice(1)) dropSeat(s);
    cancelWait();
  }

  const isLocal = (id: number) => seats.some(s => s.id === id);

  // Overcooked-style: A / Start on a free pad, or Enter / Space on a free keyboard, joins; B / Esc drops out.
  // A lone P1 has every device, so a device other than the one they last used joins (P1 keeps theirs).
  /** Who P1 is when alone: the device last used before this frame's presses (null: only the mouse so far). */
  let p1Device: InputSource | null = null;

  /** The device P1 keeps if `src` joins now, or false when it can't (taken, full, or P1's own). */
  function canJoin(src: InputSource): InputSource | false {
    if (mode !== 'lobby' || !roomId || seats.length >= MAX_SEATS || waiting) return false;
    if (seats.length === 1) return p1Device && !sameSource(p1Device, src) ? p1Device : false;
    return sourceTaken(src) ? false : p1.src;
  }

  function join(src: InputSource, p1Keeps: InputSource): void {
    if (seats.length === 1) p1.src = p1Keeps;
    cancelWait();
    const seat = addSeat(src);
    seat.net.send({ type: 'join_room', roomId });
    rumble(src, 220);
    sfx.ui();
    refreshLobby();
  }

  onPadPress((pad, button) => {
    if (button !== 0 && button !== 9) return false; // A or Start
    const src = { index: pad.index, id: pad.id }, keep = canJoin(src);
    if (!keep) return false;
    join(src, keep);
    return true;
  });

  /** Waiting for a device: + PLAYER (seat null) or a card's device pill (that seat changes device). */
  let waiting: { seat: Seat | null } | null = null;
  let stopWait = () => {};

  function startWait(seat: Seat | null): void {
    if (waiting) { const same = waiting.seat === seat; cancelWait(); if (same) return; }
    if (!seat && (seats.length >= MAX_SEATS || !roomId)) return;
    waiting = { seat };
    const p1From = lastDevice(); // + PLAYER from a lone P1: P1 keeps the device that pressed it
    const take = (src: InputSource): boolean => {
      if (seat) {
        if (seats.length > 1 && sourceTaken(src) && !sameSource(seat.src, src)) return false; // someone else's
        seat.src = src;
        setSeatSources(seats.map(s => s.src));
        cancelWait();
        rumble(src, 220);
        sfx.ui();
        return true;
      }
      if (seats.length > 1) {
        if (sourceTaken(src)) return false;
        join(src, p1.src);
        return true;
      }
      if (p1From && typeof src === 'object' && sameSource(src, p1From)) return false; // P1 pressing on again
      const pad = padsFor('any').find(p => !sameSource({ index: p.index, id: p.id }, src));
      const keep = p1From && !sameSource(p1From, src) ? p1From : src !== 'keys' ? 'keys' : pad ? { index: pad.index, id: pad.id } : null;
      if (!keep) { ui.setStatus('Player 1 needs a controller'); return false; }
      join(src, keep);
      return true;
    };
    // Capture phase: the key is this player's choice, not a lobby shortcut (Enter joining, Esc dropping out)
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.code === 'Tab') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code !== 'Escape') { take('keys'); return; }
      if (seat === p1 && seats.length === 1) { p1.src = 'any'; setSeatSources([p1.src]); } // alone: back to every device
      cancelWait();
    };
    const listenPad = () => pickPad(pad => { if (!take({ index: pad.index, id: pad.id })) listenPad(); });
    window.addEventListener('keydown', onKey, { capture: true });
    listenPad();
    stopWait = () => { window.removeEventListener('keydown', onKey, { capture: true }); pickPad(null); };
    refreshLobby();
  }

  function cancelWait(): void {
    stopWait();
    stopWait = () => {};
    if (!waiting) return;
    waiting = null;
    refreshLobby();
  }

  /** The other seats' pads in the lobby: bumpers change character, B drops out, Start readies everyone. */
  function seatPadButtons(): void {
    for (const { pad, button } of padPresses()) {
      const seat = seats.find(s => s !== p1 && padsFor(s.src)[0]?.index === pad.index);
      if (!seat) continue;
      if (button === 1) dropSeat(seat);
      else if (button === 4 || button === 5) changeCharacter(seat, button === 4 ? -1 : 1);
      else if (button === 9) readyAll();
    }
  }

  const buzzedAt = new Map<Seat, number>();
  /** Pointing at a card buzzes that player's pad. */
  function identify(seat: Seat): void {
    const t = performance.now();
    if (t - (buzzedAt.get(seat) ?? 0) < 400) return;
    buzzedAt.set(seat, t);
    rumble(seat.src, 120, 0.4);
  }

  function changeCharacter(seat: Seat, delta: number): void {
    const me = lobbyPlayers.find(p => p.id === seat.id);
    if (me) seat.net.send({ type: 'profile', character: (me.character + delta + CHAR_DEFS.length) % CHAR_DEFS.length });
    sfx.ui();
  }

  /** READY flips seat 1, and the other seats follow it. */
  function readyAll(): void {
    sfx.ui();
    const want = !lobbyPlayers.find(p => p.id === p1.id)?.ready;
    for (const s of seats) if (s.id >= 0 && !!lobbyPlayers.find(p => p.id === s.id)?.ready !== want) s.net.send({ type: 'ready' });
  }

  function refreshLobby(): void {
    if (mode === 'lobby') ui.updateLobby(roomId, lobbyPlayers, seats.map(s => ({ id: s.id, device: s.src, changing: waiting?.seat === s })), lobbyInMatch, lobbyMode, lastStandings, !!waiting && !waiting.seat);
  }

  /** Split-screen layout in CSS px: full, side by side, or a 2×2 grid (three players leave the board a quarter). */
  function layout(n: number): { rects: Rect[]; spare: Rect | null } {
    const size = world.renderer.getSize(new THREE.Vector2());
    const W = size.x, H = size.y, hw = Math.floor(W / 2), hh = Math.floor(H / 2);
    if (n <= 1) return { rects: [{ x: 0, y: 0, w: W, h: H }], spare: null };
    if (n === 2) return { rects: [{ x: 0, y: 0, w: hw, h: H }, { x: hw, y: 0, w: W - hw, h: H }], spare: null };
    const q = [{ x: 0, y: 0, w: hw, h: hh }, { x: hw, y: 0, w: W - hw, h: hh }, { x: 0, y: hh, w: hw, h: H - hh }, { x: hw, y: hh, w: W - hw, h: H - hh }];
    return { rects: q.slice(0, n), spare: n === 3 ? q[3] : null };
  }

  // ── Screens ─────────────────────────────────────────────────────────────
  function showTitle(): void {
    setInputEnabled(true);
    ui.showTitle({
      practice: m => { sfx.ui(); net.send({ type: 'create_room', mode: m, bots: PRACTICE_BOTS }); ui.setStatus('Creating room…'); },
      create: m => { sfx.ui(); net.send({ type: 'create_room', mode: m }); ui.setStatus('Creating room…'); },
      join: code => { sfx.ui(); net.send({ type: 'join_room', roomId: code }); ui.setStatus('Joining…'); },
    });
  }

  function showLobby(): void {
    mode = 'lobby';
    ui.showLobby({
      rename: (name, n) => seats[n]?.net.send({ type: 'profile', name }),
      character: (delta, n) => { if (seats[n]) changeCharacter(seats[n], delta); },
      addSeat: () => startWait(null),
      changeDevice: n => { if (seats[n]) startWait(seats[n]); },
      identify: n => { if (seats[n]) identify(seats[n]); },
      dropSeat: n => { if (seats[n]) dropSeat(seats[n]); },
      ready: readyAll,
      addBot: () => net.send({ type: 'add_bot' }),
      removeBot: () => net.send({ type: 'remove_bot' }),
      leave: leave,
      mode: m => { sfx.ui(); net.send({ type: 'mode', mode: m }); },
    });
    refreshLobby();
  }

  function leave(): void {
    dropExtraSeats();
    net.send({ type: 'leave' });
    net.disconnect();
    cleanupMatch();
    mode = 'title';
    history.replaceState(null, '', location.pathname + location.search);
    showTitle();
  }

  // ── In-match menu (Esc / Start) ─────────────────────────────────────────
  function openMenu(seat: Seat): void {
    if (mode !== 'match') return;
    menuSeat = seat;
    setMenuOwner(seat.src); // that player's pad drives it
    ui.showMenu({
      resume: closeMenu,
      controls: () => ui.showControls(seat.src, () => { ui.showHud(); openMenu(seat); }),
      toggleSound: () => { setMuted(!isMuted()); return isMuted(); },
      dropOut: seat !== p1 ? () => { closeMenu(); dropSeat(seat); } : undefined,
      leave: () => { closeMenu(); leave(); },
    }, seats.length > 1 ? seat.n : null, isMuted());
    if (!document.documentElement.classList.contains('pad')) ui.root.querySelector<HTMLElement>('.menu [data-a=back]')?.focus({ preventScroll: true });
  }

  function closeMenu(): void {
    if (!menuSeat) return;
    menuSeat = null;
    setMenuOwner(null);
    ui.hideMenu();
    if (mode === 'match') ui.showHud(); // back from CONTROLS too
  }

  /** The seat a key press belongs to: the keyboard player, else P1. */
  const keyboardSeat = () => seats.find(s => s.src === 'keys' || s.src === 'any') ?? p1;

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || ui.root.querySelector('.screen.sky.on')) return; // CONTROLS has its own keys
    if (mode === 'match' && e.code === 'Escape') {
      if (menuSeat) closeMenu(); else openMenu(keyboardSeat());
    } else if (mode === 'lobby' && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) {
      const keep = canJoin('keys');
      if (keep) join('keys', keep);
    } else if (mode === 'lobby' && e.code === 'Escape') {
      const kb = seats.find(s => s !== p1 && s.src === 'keys');
      if (kb) dropSeat(kb);
    }
  });

  onTouchMenu(() => openMenu(p1));

  /** Start on a player's pad opens their menu (Start in the open menu is RESUME, handled by pad.ts). */
  function menuPadButtons(): void {
    for (const { pad, button } of padPresses()) {
      if (button !== 9) continue;
      const seat = seats.find(s => padsFor(s.src).some(p => p.index === pad.index));
      if (seat) { openMenu(seat); return; }
    }
  }

  // ── Messages ────────────────────────────────────────────────────────────
  function handle(seat: Seat, msg: ServerMessage): void {
    if (seat !== p1) { handleSeat(seat, msg); return; }
    switch (msg.type) {
      case 'welcome':
        p1.id = cn.myId = msg.playerId;
        roomId = msg.roomId;
        if (!msg.practice) history.replaceState(null, '', `${location.pathname}${location.search}#${msg.roomId}`);
        if (!msg.practice) showLobby();
        break;
      case 'lobby':
        lobbyPlayers = msg.players;
        lastStandings = msg.lastStandings;
        lobbyInMatch = msg.inMatch;
        lobbyMode = msg.mode;
        ui.setNames(msg.players);
        refreshLobby();
        if (mode === 'match' && !msg.inMatch) { cleanupMatch(); showLobby(); }
        break;
      case 'match_start':
        gameMode = msg.mode;
        ui.setNames(msg.roster);
        startMatch(msg.roster); // clears the old match (and resets to the full city)…
        // …then build just the roofs this match uses: map size follows the player count
        setMap(world, mapFor(msg.roofs));
        fx.map = world.map;
        for (const s of seats) s.cn.map = world.map;
        break;
      case 'round_start':
        roundStart(p1, msg.round, msg.roles);
        break;
      case 'round_end':
        standings = msg.standings;
        roundEnd(p1, msg.winner, msg.swap);
        break;
      case 'match_end': {
        standings = msg.standings;
        cleanupMatch();
        mode = 'end';
        const mine = seats.map(s => s.id);
        ui.showMatchEnd(msg.standings, mine, () => showLobby());
        (mine.includes(msg.standings[0]?.id) ? sfx.win : sfx.lose)();
        break;
      }
      case 'snap':
        onSnapshot(p1, msg);
        break;
      case 'ev':
        if (mode === 'match') {
          const now = cn.pushEvents(msg.tick, msg.events, performance.now());
          playEvents(now);
          playOwn(p1, now);
        }
        break;
      case 'error':
        ui.setStatus(msg.msg);
        if (mode !== 'title') { dropExtraSeats(); mode = 'title'; showTitle(); ui.setStatus(msg.msg); }
        history.replaceState(null, '', location.pathname + location.search);
        break;
    }
  }

  /** Seats 2–4 only follow their own player; seat 1's connection runs everything else. */
  function handleSeat(seat: Seat, msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        seat.id = seat.cn.myId = msg.playerId;
        refreshLobby();
        break;
      case 'round_start':
        roundStart(seat, msg.round, msg.roles);
        break;
      case 'round_end':
        roundEnd(seat, msg.winner, msg.swap);
        break;
      case 'snap':
        onSnapshot(seat, msg);
        break;
      case 'ev':
        if (mode === 'match') playOwn(seat, seat.cn.pushEvents(msg.tick, msg.events, performance.now()));
        break;
      case 'error':
        ui.setStatus(msg.msg);
        dropSeat(seat);
        break;
    }
  }

  function startMatch(roster: LobbyPlayer[]): void {
    cleanupMatch();
    mode = 'match';
    cancelWait();
    cn.stats.reset(); // the netgraph counts per match
    ui.showHud();
    for (const p of roster) ensureChar(p.id, p.character);
    standings = roster.map(p => ({ id: p.id, name: p.name, character: p.character, score: 0, kills: 0, survived: 0 }));
  }

  function ensureChar(id: number, character?: number): Character {
    let c = chars.get(id);
    if (!c) {
      const ch = character ?? lobbyPlayers.find(p => p.id === id)?.character ?? id;
      c = new Character(ch);
      c.root.visible = false;
      world.scene.add(c.root);
      chars.set(id, c);
    }
    return c;
  }

  function cleanupMatch(): void {
    closeMenu();
    // Back to the whole city for the menu backdrop
    setMap(world, FULL_MAP);
    fx.map = world.map;
    for (const c of chars.values()) c.dispose();
    chars.clear();
    for (const s of slices) s.update(99);
    slices.length = 0;
    dead.clear();
    for (const s of seats) { s.cn.map = world.map; s.cn.reset(); }
    fx.syncProjectiles([], 0);
    fx.hideArc();
    for (let i = 0; i < seats.length; i++) ui.seat(i).hideLabelsExcept(new Set());
  }

  function roundStart(seat: Seat, round: number, r: Record<number, Role>): void {
    seat.cn.newRound();
    seat.spectate = null;
    if (seat === p1) {
      roles = r;
      dead.clear();
      phase = 'start';
      for (const [id, c] of chars) c.setRole(roles[id] ?? 'runner');
      sfx.beep(true);
    }
    const mine = r[seat.id];
    if (gameMode === 'dm') {
      seat.hud.banner(mine === 'runner' ? 'RUN!' : 'YOU\'RE IT', 'Deathmatch · tag a runner and you swap · 3:00', mine === 'runner' ? '#23f0c7' : '#ef767a', 2800);
    } else if (mine === 'runner') seat.hud.banner('RUN!', `Round ${round} · get away before the taggers wake up`, '#23f0c7', 2600);
    else if (mine === 'tagger') seat.hud.banner('YOU\'RE IT', `Round ${round} · frozen for ${HEAD_START}s…`, '#ef767a', 2600);
  }

  function roundEnd(seat: Seat, winner: Role, swap: boolean): void {
    seat.hud.banner(winner === 'runner' ? 'RUNNERS WIN!' : 'TAGGERS WIN!', swap ? 'Teams swap!' : 'Runners run again', winner === 'runner' ? '#23f0c7' : '#ef767a', 3500);
    if (seat === p1) (roles[p1.id] === winner ? sfx.win : sfx.lose)();
  }

  // ── Snapshots / prediction ──────────────────────────────────────────────
  function onSnapshot(seat: Seat, s: Snapshot): void {
    if (mode !== 'match') return;
    // Roles change mid-match in deathmatch (catch = swap): follow the server
    const myPrevRole = seat.cn.latest?.me?.role;
    if (gameMode === 'dm' && s.me && myPrevRole && myPrevRole !== s.me.role) {
      if (s.me.role === 'runner') { seat.hud.banner('TAGGED ONE!', 'You\'re a runner now · RUN!', '#23f0c7', 2000); sfx.win(); }
      else seat.hud.banner('YOU\'RE IT', 'Back in as a tagger…', '#ef767a', 1800);
    }
    seat.cn.onSnapshot(s, performance.now());
    if (seat !== p1) return;

    const prevPhase = phase;
    phase = s.phase;
    timeLeft = s.timeLeft;
    for (const p of s.players) roles[p.id] = p.role;
    // Live scores (the Tab board and the deathmatch leaderboard); late joiners get a row too
    for (const sc of s.scores) {
      let row = standings.find(r => r.id === sc.id);
      if (!row) {
        row = { id: sc.id, name: ui.nameOf(sc.id), character: lobbyPlayers.find(p => p.id === sc.id)?.character ?? 0, score: 0, kills: 0, survived: 0 };
        standings.push(row);
      }
      row.score = sc.score;
      row.kills = sc.kills;
    }
    if (gameMode === 'dm' && prevPhase === 'chase' && phase === 'end') {
      const ranked = [...standings].sort((a, b) => b.score - a.score);
      const top = ranked[0];
      const tie = ranked[1] && ranked[1].score === top?.score;
      for (const st of seats) st.hud.banner('TIME!', top ? (tie ? `Tied at ${top.score}!` : `${top.name} wins with ${top.score}`) : '', '#ffd23f', 3500);
      (top && isLocal(top.id) && !tie ? sfx.win : sfx.lose)();
    }
    if (prevPhase === 'start' && phase === 'chase') {
      for (const st of seats) st.hud.banner('READY OR NOT!', roles[st.id] === 'tagger' ? 'Go get them' : 'Here they come…', '#ffd23f', 1800);
      sfx.gong();
    }
    if (phase === 'start' && timeLeft <= 3.05 && Math.ceil(timeLeft) !== Math.ceil(timeLeft + 2 * TICK_DT)) sfx.beep();
  }

  function fixedStep(seat: Seat): void {
    const input = seat === menuSeat ? NO_INPUT : readInput(seat.src, seats.length === 1);
    const { cn } = seat;
    const step = cn.predict(input);
    if (!step) return;
    seat.net.sendInputs(cn.pending.slice(-3).map(p => ({ seq: p.seq, mx: p.input.mx, mz: p.input.mz, b: p.input.b, v: p.v })));
    const { ev } = step;
    const pred = cn.pred!, st = cn.myStatus()!, latest = cn.latest!;
    const c = chars.get(seat.id);
    if (ev.jumped) { fx.puff(pred.x, pred.y, pred.z, 5); sfx.jump(); }
    if (ev.landed > 3) { fx.puff(pred.x, pred.y, pred.z, 6); sfx.land(Math.min(1, ev.landed / 12)); c?.land(ev.landed); }
    if (ev.lunged) { fx.slash(pred.x, pred.y, pred.z, pred.facing); sfx.swish(); }

    // Runner throw arc: mirror the server's charge timer locally
    const me = latest.me!;
    // J / K pick the grenade (as the server does); Enter uses the selected one
    if (ev.pressed & BTN_ACTION) seat.aimKind = input.b & BTN_FROST ? 'frost' : 'flash';
    const canAim = me.alive && me.role === 'runner' && !st.locked && !st.frozen && me.nades[seat.aimKind] > 0;
    if (canAim && (input.b & BTN_ACTION)) seat.aimHeld = seat.prevAction || seat.aimHeld > 0 ? seat.aimHeld + TICK_DT : (ev.pressed & BTN_ACTION ? TICK_DT : 0);
    else seat.aimHeld = 0;

    // Spectator: action cycles who we watch
    if (!me.alive && (input.b & BTN_ACTION) && !seat.prevAction) seat.spectate = nextSpectate(seat);
    seat.prevAction = (input.b & BTN_ACTION) !== 0;
  }

  function nextSpectate(seat: Seat): number | null {
    const alive = [...(cn.buffer.at(-1)?.players.values() ?? [])].filter(p => p.alive && p.id !== seat.id).map(p => p.id).sort((a, b) => a - b);
    if (!alive.length) return null;
    const i = seat.spectate === null ? -1 : alive.indexOf(seat.spectate);
    return alive[(i + 1) % alive.length];
  }

  // ── Events → juice ──────────────────────────────────────────────────────
  /** Volume and pan for a sound, heard from whichever seat's camera is closest. */
  function hear(x: number, z: number): { vol: number; pan: number } {
    let best = { vol: 0, pan: 0 };
    for (const s of seats) {
      const sp = spatial(x, z, s.camTarget.x, s.camTarget.z);
      if (sp.vol > best.vol) best = seats.length > 1 ? { vol: sp.vol, pan: sp.pan * 0.5 } : sp;
    }
    return best;
  }

  function safely(events: GameEvent[], fn: (e: GameEvent) => void): void {
    for (const e of events) {
      try {
        fn(e);
      } catch (err) {
        console.error('event effect failed', e.k, err); // never let one effect drop the rest
      }
    }
  }

  /** The world's side of events (effects, sounds, slices), from seat 1's connection. */
  function playEvents(events: GameEvent[]): void {
    safely(events, onEvent);
  }

  /** A seat's own side (its banners, its shake, its camera), from that seat's connection. */
  function playOwn(seat: Seat, events: GameEvent[]): void {
    safely(events, e => onOwnEvent(seat, e));
  }

  function onEvent(e: GameEvent): void {
    if (mode !== 'match') return;
    const posOf = (id: number) => {
      const seat = seats.find(s => s.id === id);
      if (seat?.cn.pred) return seat.cn.pred;
      const c = chars.get(id);
      return c ? { x: c.root.position.x, y: c.root.position.y, z: c.root.position.z, facing: c.root.rotation.y } : null;
    };
    switch (e.k) {
      case 'stab': {
        if (isLocal(e.by)) break; // already predicted locally
        const p = posOf(e.by);
        if (p && chars.get(e.by)?.root.visible) {
          fx.slash(p.x, p.y, p.z, p.facing);
          const sp = hear(p.x, p.z);
          sfx.swish(sp.vol, sp.pan);
        }
        break;
      }
      case 'hurt': {
        const p = posOf(e.id);
        const c = chars.get(e.id);
        if (p && c?.root.visible) {
          fx.juice(p.x, p.y, p.z, c.def.juice, 0, 0, 10);
          const sp = hear(p.x, p.z);
          sfx.hit(sp.vol, sp.pan);
          if (sp.vol > 0.5) fx.freeze(0.05, 0.03);
        }
        break;
      }
      case 'kill': {
        const c = chars.get(e.id);
        dead.add(e.id);
        if (c) {
          const victim = seats.find(s => s.id === e.id);
          const facing = victim?.cn.pred ? victim.cn.pred.facing : c.root.rotation.y;
          // Slice them where this screen shows them: us where we're predicted, our own victims
          // where we saw them (that's what the hit was judged by), anyone else where the server had them
          const shown = (isLocal(e.id) || (e.by !== null && isLocal(e.by))) && c.root.visible ? c.root.position : null;
          const x = shown?.x ?? e.x, y = shown?.y ?? e.y, z = shown?.z ?? e.z;
          slices.push(new SliceDeath(world.scene, world.map, c, x, y, z, facing, e.dx, e.dz));
          if (e.cause !== 'void') fx.juice(x, y, z, c.def.juice, e.dx, e.dz);
          c.root.visible = false;
        }
        const sp = hear(e.x, e.z);
        sfx.kill(Math.max(0.25, sp.vol), sp.pan);
        // Boomerang Fu holds the frame on a kill: freeze + zoom punch when it's near us
        if (sp.vol > 0.3 || isLocal(e.id) || (e.by !== null && isLocal(e.by))) { fx.freeze(0.12, 0.08); fx.addShake(0.4); }
        const victim = esc(ui.nameOf(e.id));
        const icon = { stab: '🔪', fall: '💥 splat', void: e.by !== null ? '👋 knocked off' : '☁️ fell' }[e.cause];
        ui.killfeed(e.by !== null ? `${esc(ui.nameOf(e.by))} ${icon} ${victim}` : `${victim} ${icon}`);
        break;
      }
      case 'throw': {
        const p = posOf(e.by);
        if (!p) break;
        const sp = hear(p.x, p.z);
        sfx.throw(sp.vol, sp.pan);
        break;
      }
      case 'det': {
        const sp = hear(e.x, e.z);
        fx.detonate(e.kind, e.x, e.y, e.z, sp.vol);
        const v = Math.max(0.2, sp.vol);
        ({ flash: sfx.flash, frost: sfx.frost } as Record<NadeKind, (v: number, p: number) => void>)[e.kind](v, sp.pan);
        break;
      }
      case 'stomp': {
        const sp = hear(e.x, e.z);
        sfx.boing(Math.max(0.3, sp.vol), sp.pan);
        fx.puff(e.x, e.y, e.z, 8, 0xffd23f, 0.14);
        break;
      }
      case 'spawn': {
        dead.delete(e.id);
        fx.puff(e.x, e.y, e.z, 10, 0xffffff, 0.22);
        break;
      }
      case 'bounce': {
        const sp = hear(e.x, e.z);
        if (sp.vol > 0.1) sfx.bounce(sp.vol, sp.pan);
        break;
      }
    }
  }

  function onOwnEvent(seat: Seat, e: GameEvent): void {
    if (mode !== 'match') return;
    const me = seat.id, hud = seat.hud;
    switch (e.k) {
      case 'hurt':
        if (e.id === me) { sfx.hurt(); fx.addShake(0.35); }
        break;
      case 'kill':
        if (e.id === me) hud.banner(e.cause === 'void' ? 'WHOOPS!' : 'SLICED!', gameMode === 'dm' ? (e.by === null ? '−1 for falling off' : roles[me] === 'runner' ? 'Tagged! You\'ll come back as a tagger' : '') : 'Spectating · press J to switch', '#f0408f', 2200);
        if (e.by === me) hud.banner('GOTCHA!', '', '#ffd23f', 1100);
        break;
      case 'det':
        if (e.hits.includes(me) && e.kind === 'frost') hud.banner(e.frozen.includes(me) ? 'FROZEN!' : 'CHILLED', '', '#8fe3ff', 1200);
        break;
      case 'refill':
        if (e.id === me) { hud.banner(`+1 ${e.kind.toUpperCase()}`, '', e.kind === 'frost' ? '#8fe3ff' : '#ffd23f', 900); sfx.ui(); }
        break;
      case 'stomp':
        if (e.by === me) hud.banner('STOMP!', '', '#ffd23f', 900);
        if (e.id === me) { hud.banner('DIZZY!', '', '#ef767a', 900); fx.addShake(0.3); }
        break;
      case 'spawn':
        if (e.id === me) {
          seat.camTarget.set(e.x, e.y, e.z); // respawns are across the map: cut, don't pan
          hud.banner('GO!', '', '#ffd23f', 700);
        }
        break;
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  let last = performance.now();
  let fpsFrames = 0, fpsT = 0, fps = 0;
  let debugOn = false;
  let jsMs = 0, renderMs = 0;
  let boardHeld = false;

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'KeyP') debugOn = !debugOn;
    if (e.code === 'KeyM') setMuted(!isMuted());
  });

  function frame(): void {
    const now = performance.now();
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const menuWasOpen = menuSeat !== null; // so the Start that closes it doesn't reopen it
    pollPad();
    p1Device = lastDevice(); // after this frame's presses were judged against the old one
    if (mode === 'lobby') seatPadButtons();
    if (mode === 'match' && !menuWasOpen) menuPadButtons();
    fpsFrames++; fpsT += dt;
    adaptResolution(world, dt);
    if (fpsT >= 1) { fps = fpsFrames; fpsFrames = 0; fpsT = 0; }

    // Fixed 60Hz simulation for the local players (inputs are sent at the same rate)
    if (mode === 'match') {
      acc += dt;
      let n = 0;
      while (acc >= TICK_DT && n < 8) { for (const s of seats) fixedStep(s); acc -= TICK_DT; n++; }
      if (n === 8) acc = 0;
    }

    // Hitstop: hold the visuals for a beat (the sim keeps running underneath)
    if (fx.hitstop > 0) { fx.hitstop -= dt; dt *= 0.08; }

    const split = mode === 'match' ? layout(seats.length) : layout(1);
    if (mode === 'match') renderMatch(dt, split.rects, split.spare);
    else { renderIdle(dt); updateTouch(null); }

    fx.update(dt);
    for (let i = slices.length - 1; i >= 0; i--) { slices[i].update(dt); if (slices[i].done) slices.splice(i, 1); }

    const ns = cn.stats;
    // Netgraph: how we're connected and what the network is doing to us (totals this match)
    ui.debug(debugOn ? `${net.transport.toUpperCase()} · ping ${net.rtt.toFixed(0)}ms · others ${Math.round(cn.delay * TICK_DT * 1000)}ms behind\n`
      + `late snapshots ${ns.gaps} (worst ${Math.round(ns.maxGap)}ms) · frozen ${(ns.starvedMs / 1000).toFixed(1)}s\n`
      + `corrections ${ns.corrections} · teleports ${ns.teleports} · unacked ${cn.pending.length}\n`
      + `fps ${fps} · tick ${cn.latest?.tick ?? "-"} · draws ${world.renderer.info.render.calls} · tris ${(world.renderer.info.render.triangles / 1000).toFixed(0)}k\ndpr ${world.renderer.getPixelRatio().toFixed(2)} · js ${jsMs.toFixed(1)}ms · render ${renderMs.toFixed(1)}ms`
      + (seats.length > 1 ? `\nseats ${seats.length} · ${seats.map(s => `${s.id}: ${s.net.transport} ${s.net.rtt.toFixed(0)}ms`).join(' · ')}` : '') : null);
    const tRender = performance.now();
    draw(split.rects, split.spare);
    // Smoothed CPU cost per frame: game logic vs. submitting the render (shown in the P HUD)
    jsMs = jsMs * 0.95 + (tRender - now) * 0.05;
    renderMs = renderMs * 0.95 + (performance.now() - tRender) * 0.05;
    requestAnimationFrame(frame);
  }

  /** One camera full screen, or each seat's camera in its own viewport (and the overview in a spare quarter). */
  function draw(rects: Rect[], spare: Rect | null): void {
    const r = world.renderer;
    if (rects.length === 1) {
      r.setScissorTest(false);
      r.setViewport(0, 0, rects[0].w, rects[0].h);
      r.render(world.scene, world.camera);
      return;
    }
    const H = r.getSize(new THREE.Vector2()).y;
    const views: [Rect, THREE.PerspectiveCamera][] = seats.map((s, i) => [rects[i], s.camera]);
    if (spare) views.push([spare, overview]);
    r.setScissorTest(true);
    r.info.autoReset = false; // the netgraph counts the whole frame
    r.info.reset();
    for (const [v, cam] of views) {
      const y = H - v.y - v.h; // WebGL counts from the bottom
      r.setViewport(v.x, y, v.w, v.h);
      r.setScissor(v.x, y, v.w, v.h);
      r.render(world.scene, cam);
    }
    r.info.autoReset = true;
  }

  // Dev: ?cam=x,z,dist parks the camera and hides the UI (map screenshots)
  const devCam = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
  if (devCam) ui.root.style.display = 'none';
  // Dev: &players=N previews the map size that many players get
  const devPlayers = Number(new URLSearchParams(location.search).get('players'));
  if (devCam && devPlayers > 0) setMap(world, mapFor(roofsForPlayers(devPlayers)));

  function renderIdle(dt: number): void {
    fitCamera(world.camera, layout(1).rects[0]);
    if (devCam) { aimCamera(world.camera, devCam[0], 0, devCam[1], devCam[2] || CAMERA_DIST); return; }
    // Title/lobby backdrop: drift slowly across the rooftops
    titleT += dt;
    const x = Math.sin(titleT * 0.05) * 18, z = -4 + Math.cos(titleT * 0.035) * 9;
    aimCamera(world.camera, x, 1, z, CAMERA_DIST + 6);
  }

  function fitCamera(cam: THREE.PerspectiveCamera, r: Rect): void {
    const aspect = r.w / Math.max(1, r.h);
    if (Math.abs(cam.aspect - aspect) > 1e-4) { cam.aspect = aspect; cam.updateProjectionMatrix(); }
  }

  function renderMatch(dt: number, rects: Rect[], spare: Rect | null): void {
    const now = performance.now();
    for (const s of seats) s.cn.advance(dt, now);
    const due = cn.dueEvents(now);
    playEvents(due);
    playOwn(p1, due);
    for (const s of seats) if (s !== p1) playOwn(s, s.cn.dueEvents(now));
    timeLeft = Math.max(0, timeLeft - dt);

    const remote = cn.interpolate();
    const shown = new Set<number>();

    // Local players from their own prediction (+ decaying correction offset)
    for (const seat of seats) {
      const me = seat.cn.latest?.me ?? null;
      const pred = seat.cn.pred;
      const at = pred ? seat.cn.drawPos(acc / TICK_DT) : null; // smoothed between ticks
      const c = seat.id >= 0 ? chars.get(seat.id) ?? ensureChar(seat.id) : undefined;
      const alive = !!me && (me.alive || seat.cn.deathPending()); // keep showing them until their death plays
      if (c && pred && at && me && alive && !dead.has(seat.id)) {
        c.root.visible = !remote.get(seat.id)?.prot || Math.floor(now / 90) % 2 === 0;
        c.root.position.set(at.x, at.y, at.z);
        c.root.rotation.y = lerpAngle(c.root.rotation.y, pred.facing, Math.min(1, dt * 20));
        const charging = seat.aimHeld > 0 ? Math.min(1, seat.aimHeld / NADE_CHARGE_TIME) : 0;
        c.setNade(charging > 0 ? seat.aimKind : null);
        c.setRole(me.role);
        c.update(dt, {
          speed: Math.hypot(pred.vx, pred.vz), vy: pred.vy, grounded: pred.grounded, lunge: pred.lunge,
          aiming: charging, frozen: me.frozen > 0, chilled: me.chilled > 0, stunned: me.stun > 0,
          ground: world.map.heightAt(at.x, at.z),
        });
        if (charging > 0) fx.showArc(seat.n, at.x, at.y, at.z, pred.facing, pred.vx, pred.vz, charging); else fx.hideArc(seat.n);
        shown.add(seat.id);
      } else {
        fx.hideArc(seat.n);
        if (c) c.root.visible = false;
      }
    }

    for (const [id, p] of remote) {
      if (isLocal(id)) continue;
      const c = ensureChar(id);
      const vis = p.visible && p.alive && !dead.has(id);
      // Spawn protection: blink
      c.root.visible = vis && (!p.prot || Math.floor(now / 90) % 2 === 0);
      if (!vis) continue;
      c.root.position.set(p.x, p.y, p.z);
      c.root.rotation.y = lerpAngle(c.root.rotation.y, p.f, Math.min(1, dt * 20));
      c.setRole(p.role);
      c.setNade(p.nade);
      c.update(dt, {
        speed: Math.hypot(p.vx, p.vz), vy: p.vy, grounded: Math.abs(p.vy) < 0.01, lunge: p.lunge,
        aiming: p.aiming, frozen: p.frozen > 0, chilled: p.chilled > 0, stunned: p.stun > 0, ground: world.map.heightAt(p.x, p.z),
      });
      shown.add(id);
    }
    for (const [id, c] of chars) if (!remote.has(id) && !isLocal(id)) c.root.visible = false;

    const snap = cn.buffer.at(-1)?.snap;
    if (snap) {
      fx.syncProjectiles(snap.projectiles, dt);
      // Weak planks: shake, collapse, rebuild (with sound when it's near)
      for (const ch of updatePlanks(world, snap.planks, dt)) {
        const br = world.map.bridges[ch.i];
        const sp = hear((br.x0 + br.x1) / 2, (br.z0 + br.z1) / 2);
        if (ch.to === 1) sfx.creak(sp.vol, sp.pan);
        if (ch.to === 2) { sfx.crash(sp.vol, sp.pan); fx.puff((br.x0 + br.x1) / 2, br.h, (br.z0 + br.z1) / 2, 8, 0xc9a27c, 0.2); }
      }
    }

    const split = seats.length > 1;
    ui.placeSeats(rects, seats.map(s => s.src), spare);
    const teams = Object.entries(roles).map(([id, role]) => ({ id: Number(id), role, alive: !dead.has(Number(id)) }));
    const v = new THREE.Vector3();
    for (const seat of seats) {
      const me = seat.cn.latest?.me ?? null;
      const pred = seat.cn.pred;
      const at = pred ? seat.cn.drawPos(acc / TICK_DT) : null;
      const alive = !!me && (me.alive || seat.cn.deathPending());
      const rect = rects[seat.n];

      // Camera: follow me, or whoever I'm spectating
      const t = seat.camTarget;
      let fx0 = t.x, fy0 = t.y, fz0 = t.z, lookVx = 0, lookVz = 0;
      if (pred && at && alive) {
        fx0 = at.x; fy0 = at.y; fz0 = at.z; lookVx = pred.vx; lookVz = pred.vz;
      } else if (gameMode === 'tag') {
        if (seat.spectate === null || !remote.get(seat.spectate)?.alive) seat.spectate = nextSpectate(seat);
        const sp = seat.spectate !== null ? remote.get(seat.spectate) : undefined;
        if (sp) { fx0 = sp.x; fy0 = sp.y; fz0 = sp.z; lookVx = sp.vx; lookVz = sp.vz; }
      }
      const k = 1 - Math.exp(-dt * 6);
      t.x += (fx0 + lookVx * 0.25 - t.x) * k;
      t.y += (Math.max(0, fy0) - t.y) * k * 0.5;
      t.z += (fz0 + lookVz * 0.2 - t.z) * k;
      const shake = fx.shake * fx.shake;
      fitCamera(seat.camera, rect);
      aimCamera(seat.camera,
        t.x + (Math.random() - 0.5) * shake, t.y, t.z + (Math.random() - 0.5) * shake,
        CAMERA_DIST * (1 - fx.zoomPunch * 2));

      // Name labels: YOU on your own player; split screen tags the other seats P2, P3…
      for (const id of shown) {
        const c = chars.get(id)!;
        v.set(c.root.position.x, c.root.position.y + 1.45, c.root.position.z).project(seat.camera);
        const sx = (v.x * 0.5 + 0.5) * rect.w, sy = (-v.y * 0.5 + 0.5) * rect.h;
        const other = seats.find(s => s.id === id);
        const role = other ? other.cn.latest?.me?.role : remote.get(id)?.role;
        // Everyone (you too) wears their team colour
        const color = role === 'tagger' ? hex(COLOR_TAGGER) : '#14bfa0';
        const text = id === seat.id ? 'YOU' : other && split ? `P${other.n + 1} ${ui.nameOf(id)}` : ui.nameOf(id);
        seat.hud.label(id, sx, sy, text, color, split && other ? SEAT_COLORS[other.n] : undefined);
      }
      seat.hud.hideLabelsExcept(shown);

      // HUD
      if (me) {
        const hud: HudState = {
          phase, timeLeft, role: me.role, alive: me.alive, frozen: me.frozen, blind: me.blind,
          nades: me.nades, teams,
          spectating: gameMode === 'tag' && !me.alive && seat.spectate !== null ? ui.nameOf(seat.spectate) : null,
          mode: gameMode,
          respawn: me.respawn,
        };
        seat.hud.updateHud(hud);
        if (seat === p1) updateTouch(split || menuSeat ? null : { role: me.role, alive: me.alive, nades: me.nades, spectating: hud.spectating !== null });
      } else if (seat === p1) updateTouch(null);
    }
    if (spare) {
      fitCamera(overview, spare);
      const bs = world.map.buildings;
      const x0 = Math.min(...bs.map(b => b.x0)), x1 = Math.max(...bs.map(b => b.x1));
      const z0 = Math.min(...bs.map(b => b.z0)), z1 = Math.max(...bs.map(b => b.z1));
      aimCamera(overview, (x0 + x1) / 2, 0, (z0 + z1) / 2, CAMERA_DIST * Math.max(2, (x1 - x0) / 30, (z1 - z0) / 18));
    }
    const tab = isHeld('Tab') || touchBoardHeld() || padBoardHeld();
    if (tab !== boardHeld || tab || spare) ui.showBoard(tab, standings, seats.map(s => s.id));
    boardHeld = tab;
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  showTitle();
  requestAnimationFrame(frame);
  const params = new URLSearchParams(location.search);
  const hashRoom = location.hash.slice(1);
  if (params.has('practice')) net.send({ type: 'create_room', practice: true, mode: params.get('practice') === 'dm' ? 'dm' : 'tag' });
  else if (hashRoom) net.send({ type: 'join_room', roomId: hashRoom });
}


function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
