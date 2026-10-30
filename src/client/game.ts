// Client glue: lobby flow, fixed-step prediction + reconciliation for the local player,
// snapshot interpolation for everyone else, and turning server events into juice.
import * as THREE from 'three';
import { createWorld, aimCamera, adaptResolution, setMap, updatePlanks, CAMERA_DIST, type World } from './world';
import { Character, SliceDeath, CHAR_DEFS } from './characters';
import { Fx } from './fx';
import { UI, esc, type HudState } from './ui';
import { Network } from './net';
import { readInput, isHeld, setInputEnabled } from './input';
import { sfx, spatial, setMuted, isMuted } from './audio';
import { BTN_ACTION, BTN_FLASH, BTN_FROST, type Role } from '../shared/sim';
import { ClientNet, lerpAngle } from './netcode';
import { FULL_MAP, mapFor, roofsForPlayers } from '../shared/map';
import { TICK_DT, TICK_RATE, NADE_CHARGE_TIME, COLOR_TAGGER, HEAD_START, type NadeKind } from '../shared/constants';
import type { GameEvent, GameMode, LobbyPlayer, Phase, ServerMessage, Snapshot, Standing } from '../shared/protocol';

type Mode = 'title' | 'lobby' | 'match' | 'end';

export function startGame(): void {
  const world: World = createWorld(document.getElementById('app')!);
  const fx = new Fx(world.scene);
  const ui = new UI();
  const net = new Network(handle);
  const cn = new ClientNet(world.map); // prediction, snapshot buffer, render clock
  // For the netgraph and browser tests
  (window as unknown as { __net: unknown }).__net = { transport: () => net.transport, stats: cn.stats, delay: () => cn.delay, rtt: () => net.rtt,
    server: () => ({ ack: cn.latest?.ack ?? 0, x: cn.latest?.me?.x ?? 0, z: cn.latest?.me?.z ?? 0, alive: !!cn.latest?.me?.alive, phase: cn.latest?.phase, frozen: cn.latest?.me?.frozen ?? 0, stun: cn.latest?.me?.stun ?? 0 }),
  };

  let mode: Mode = 'title';
  let myId = -1;
  let roomId = '';
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
  let aimHeld = 0;
  let aimKind: NadeKind = 'flash'; // grenade being aimed
  let prevAction = false;
  let spectate: number | null = null;

  // Camera
  const camTarget = new THREE.Vector3(0, 1, -3);
  let titleT = 0;

  net.onClose = () => {
    if (mode !== 'title') {
      cleanupMatch();
      mode = 'title';
      showTitle();
      ui.setStatus('Disconnected from server');
    }
  };

  // ── Screens ─────────────────────────────────────────────────────────────
  function showTitle(): void {
    setInputEnabled(true);
    ui.showTitle({
      practice: m => { sfx.ui(); net.send({ type: 'create_room', practice: true, mode: m }); ui.setStatus('Starting…'); },
      create: m => { sfx.ui(); net.send({ type: 'create_room', mode: m }); ui.setStatus('Creating room…'); },
      join: code => { sfx.ui(); net.send({ type: 'join_room', roomId: code }); ui.setStatus('Joining…'); },
    });
  }

  function showLobby(): void {
    mode = 'lobby';
    ui.showLobby({
      rename: name => net.send({ type: 'profile', name }),
      character: delta => {
        const me = lobbyPlayers.find(p => p.id === myId);
        if (me) net.send({ type: 'profile', character: (me.character + delta + CHAR_DEFS.length) % CHAR_DEFS.length });
        sfx.ui();
      },
      ready: () => { sfx.ui(); net.send({ type: 'ready' }); },
      addBot: () => net.send({ type: 'add_bot' }),
      removeBot: () => net.send({ type: 'remove_bot' }),
      leave: leave,
      mode: m => { sfx.ui(); net.send({ type: 'mode', mode: m }); },
    });
    ui.updateLobby(roomId, lobbyPlayers, myId, lobbyInMatch, lobbyMode, lastStandings);
  }

  function leave(): void {
    net.send({ type: 'leave' });
    net.disconnect();
    cleanupMatch();
    mode = 'title';
    history.replaceState(null, '', location.pathname + location.search);
    showTitle();
  }

  // ── Messages ────────────────────────────────────────────────────────────
  function handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        myId = msg.playerId;
        cn.myId = myId;
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
        if (mode === 'lobby') ui.updateLobby(roomId, lobbyPlayers, myId, lobbyInMatch, lobbyMode, lastStandings);
        if (mode === 'match' && !msg.inMatch) { cleanupMatch(); showLobby(); }
        break;
      case 'match_start':
        gameMode = msg.mode;
        ui.setNames(msg.roster);
        startMatch(msg.roster); // clears the old match (and resets to the full city)…
        // …then build just the roofs this match uses: map size follows the player count
        setMap(world, mapFor(msg.roofs));
        fx.map = cn.map = world.map;
        break;
      case 'round_start':
        roundStart(msg.round, msg.roles);
        break;
      case 'round_end':
        standings = msg.standings;
        roundEnd(msg.winner, msg.swap);
        break;
      case 'match_end':
        standings = msg.standings;
        cleanupMatch();
        mode = 'end';
        ui.showMatchEnd(msg.standings, myId, () => showLobby());
        (msg.standings[0]?.id === myId ? sfx.win : sfx.lose)();
        break;
      case 'snap':
        onSnapshot(msg);
        break;
      case 'ev':
        if (mode === 'match') playEvents(cn.pushEvents(msg.tick, msg.events, performance.now()));
        break;
      case 'error':
        ui.setStatus(msg.msg);
        if (mode !== 'title') { mode = 'title'; showTitle(); ui.setStatus(msg.msg); }
        history.replaceState(null, '', location.pathname + location.search);
        break;
    }
  }

  function startMatch(roster: LobbyPlayer[]): void {
    cleanupMatch();
    mode = 'match';
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
    // Back to the whole city for the menu backdrop
    setMap(world, FULL_MAP);
    fx.map = cn.map = world.map;
    for (const c of chars.values()) c.dispose();
    chars.clear();
    for (const s of slices) s.update(99);
    slices.length = 0;
    dead.clear();
    cn.reset();
    fx.syncProjectiles([], 0);
    fx.hideArc();
    ui.hideLabelsExcept(new Set());
  }

  function roundStart(round: number, r: Record<number, Role>): void {
    roles = r;
    dead.clear();
    phase = 'start';
    cn.newRound();
    spectate = null;
    for (const [id, c] of chars) c.setRole(roles[id] ?? 'runner');
    const mine = roles[myId];
    if (gameMode === 'dm') {
      ui.banner(mine === 'runner' ? 'RUN!' : 'YOU\'RE IT', 'Deathmatch · tag a runner and you swap · 3:00', mine === 'runner' ? '#23f0c7' : '#ef767a', 2800);
    } else if (mine === 'runner') ui.banner('RUN!', `Round ${round} · get away before the taggers wake up`, '#23f0c7', 2600);
    else if (mine === 'tagger') ui.banner('YOU\'RE IT', `Round ${round} · frozen for ${HEAD_START}s…`, '#ef767a', 2600);
    sfx.beep(true);
  }

  function roundEnd(winner: Role, swap: boolean): void {
    const mine = roles[myId];
    ui.banner(winner === 'runner' ? 'RUNNERS WIN!' : 'TAGGERS WIN!', swap ? 'Teams swap!' : 'Runners run again', winner === 'runner' ? '#23f0c7' : '#ef767a', 3500);
    (mine === winner ? sfx.win : sfx.lose)();
  }

  // ── Snapshots / prediction ──────────────────────────────────────────────
  function onSnapshot(s: Snapshot): void {
    if (mode !== 'match') return;
    const prevPhase = phase;
    phase = s.phase;
    timeLeft = s.timeLeft;
    // Roles change mid-match in deathmatch (catch = swap): follow the server
    const myPrevRole = roles[myId];
    for (const p of s.players) roles[p.id] = p.role;
    if (gameMode === 'dm' && s.me && myPrevRole && myPrevRole !== s.me.role) {
      if (s.me.role === 'runner') { ui.banner('TAGGED ONE!', 'You\'re a runner now · RUN!', '#23f0c7', 2000); sfx.win(); }
      else ui.banner('YOU\'RE IT', 'Back in as a tagger…', '#ef767a', 1800);
    }
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
      ui.banner('TIME!', top ? (tie ? `Tied at ${top.score}!` : `${top.name} wins with ${top.score}`) : '', '#ffd23f', 3500);
      (top?.id === myId && !tie ? sfx.win : sfx.lose)();
    }
    if (prevPhase === 'start' && phase === 'chase') {
      ui.banner('READY OR NOT!', roles[myId] === 'tagger' ? 'Go get them' : 'Here they come…', '#ffd23f', 1800);
      sfx.gong();
    }
    if (phase === 'start' && timeLeft <= 3.05 && Math.ceil(timeLeft) !== Math.ceil(timeLeft + 2 * TICK_DT)) sfx.beep();

    cn.onSnapshot(s, performance.now());
  }

  function fixedStep(): void {
    const input = readInput();
    const step = cn.predict(input);
    if (!step) return;
    net.sendInputs(cn.pending.slice(-3).map(p => ({ seq: p.seq, mx: p.input.mx, mz: p.input.mz, b: p.input.b, v: p.v })));
    const { ev } = step;
    const pred = cn.pred!, st = cn.myStatus()!, latest = cn.latest!;
    const c = chars.get(myId);
    if (ev.jumped) { fx.puff(pred.x, pred.y, pred.z, 5); sfx.jump(); }
    if (ev.landed > 3) { fx.puff(pred.x, pred.y, pred.z, 6); sfx.land(Math.min(1, ev.landed / 12)); c?.land(ev.landed); }
    if (ev.lunged) { fx.slash(pred.x, pred.y, pred.z, pred.facing); sfx.swish(); }

    // Runner throw arc: mirror the server's charge timer locally
    const me = latest.me!;
    // J / K pick the grenade (as the server does); Enter uses the selected one
    if (ev.pressed & BTN_ACTION) aimKind = input.b & BTN_FROST ? 'frost' : 'flash';
    const canAim = me.alive && me.role === 'runner' && !st.locked && !st.frozen && me.nades[aimKind] > 0;
    if (canAim && (input.b & BTN_ACTION)) aimHeld = prevAction || aimHeld > 0 ? aimHeld + TICK_DT : (ev.pressed & BTN_ACTION ? TICK_DT : 0);
    else aimHeld = 0;

    // Spectator: action cycles who we watch
    if (!me.alive && (input.b & BTN_ACTION) && !prevAction) spectate = nextSpectate();
    prevAction = (input.b & BTN_ACTION) !== 0;
  }

  function nextSpectate(): number | null {
    const alive = [...(cn.buffer.at(-1)?.players.values() ?? [])].filter(p => p.alive && p.id !== myId).map(p => p.id).sort((a, b) => a - b);
    if (!alive.length) return null;
    const i = spectate === null ? -1 : alive.indexOf(spectate);
    return alive[(i + 1) % alive.length];
  }

  // ── Events → juice ──────────────────────────────────────────────────────
  function listener(): { x: number; z: number } {
    return { x: camTarget.x, z: camTarget.z };
  }

  function playEvents(events: GameEvent[]): void {
    for (const e of events) {
      try {
        onEvent(e);
      } catch (err) {
        console.error('event effect failed', e.k, err); // never let one effect drop the rest
      }
    }
  }

  function onEvent(e: GameEvent): void {
    if (mode !== 'match') return;
    const L = listener();
    const posOf = (id: number) => {
      if (id === myId && cn.pred) return cn.pred;
      const c = chars.get(id);
      return c ? { x: c.root.position.x, y: c.root.position.y, z: c.root.position.z, facing: c.root.rotation.y } : null;
    };
    switch (e.k) {
      case 'stab': {
        if (e.by === myId) break; // already predicted locally
        const p = posOf(e.by);
        if (p && chars.get(e.by)?.root.visible) {
          fx.slash(p.x, p.y, p.z, p.facing);
          const sp = spatial(p.x, p.z, L.x, L.z);
          sfx.swish(sp.vol, sp.pan);
        }
        break;
      }
      case 'hurt': {
        const p = posOf(e.id);
        const c = chars.get(e.id);
        if (p && c?.root.visible) {
          fx.juice(p.x, p.y, p.z, c.def.juice, 0, 0, 10);
          const sp = spatial(p.x, p.z, L.x, L.z);
          sfx.hit(sp.vol, sp.pan);
          if (sp.vol > 0.5) fx.freeze(0.05, 0.03);
        }
        if (e.id === myId) { sfx.hurt(); fx.addShake(0.35); }
        break;
      }
      case 'kill': {
        const c = chars.get(e.id);
        dead.add(e.id);
        if (c) {
          const facing = e.id === myId && cn.pred ? cn.pred.facing : c.root.rotation.y;
          // Slice them where this screen shows them: us where we're predicted, our own victims
          // where we saw them (that's what the hit was judged by), anyone else where the server had them
          const shown = (e.id === myId || e.by === myId) && c.root.visible ? c.root.position : null;
          const x = shown?.x ?? e.x, y = shown?.y ?? e.y, z = shown?.z ?? e.z;
          slices.push(new SliceDeath(world.scene, world.map, c, x, y, z, facing, e.dx, e.dz));
          if (e.cause !== 'void') fx.juice(x, y, z, c.def.juice, e.dx, e.dz);
          c.root.visible = false;
        }
        const sp = spatial(e.x, e.z, L.x, L.z);
        sfx.kill(Math.max(0.25, sp.vol), sp.pan);
        // Boomerang Fu holds the frame on a kill: freeze + zoom punch when it's near us
        if (sp.vol > 0.3 || e.id === myId || e.by === myId) { fx.freeze(0.12, 0.08); fx.addShake(0.4); }
        const victim = esc(ui.nameOf(e.id));
        const icon = { stab: '🔪', fall: '💥 splat', void: e.by !== null ? '👋 knocked off' : '☁️ fell' }[e.cause];
        ui.killfeed(e.by !== null ? `${esc(ui.nameOf(e.by))} ${icon} ${victim}` : `${victim} ${icon}`);
        if (e.id === myId) ui.banner(e.cause === 'void' ? 'WHOOPS!' : 'SLICED!', gameMode === 'dm' ? (e.by === null ? '−1 for falling off' : roles[myId] === 'runner' ? 'Tagged! You\'ll come back as a tagger' : '') : 'Spectating · press J to switch', '#f0408f', 2200);
        if (e.by === myId) ui.banner('GOTCHA!', '', '#ffd23f', 1100);
        break;
      }
      case 'throw': {
        const p = posOf(e.by);
        if (!p) break;
        const sp = spatial(p.x, p.z, L.x, L.z);
        sfx.throw(sp.vol, sp.pan);
        break;
      }
      case 'det': {
        const sp = spatial(e.x, e.z, L.x, L.z);
        fx.detonate(e.kind, e.x, e.y, e.z, sp.vol);
        const v = Math.max(0.2, sp.vol);
        ({ flash: sfx.flash, frost: sfx.frost } as Record<NadeKind, (v: number, p: number) => void>)[e.kind](v, sp.pan);
        if (e.hits.includes(myId) && e.kind === 'frost') ui.banner('FROZEN!', '', '#8fe3ff', 1200);
        break;
      }
      case 'refill': {
        if (e.id === myId) { ui.banner(`+1 ${e.kind.toUpperCase()}`, '', e.kind === 'frost' ? '#8fe3ff' : '#ffd23f', 900); sfx.ui(); }
        break;
      }
      case 'stomp': {
        const sp = spatial(e.x, e.z, L.x, L.z);
        sfx.boing(Math.max(0.3, sp.vol), sp.pan);
        fx.puff(e.x, e.y, e.z, 8, 0xffd23f, 0.14);
        if (e.by === myId) ui.banner('STOMP!', '', '#ffd23f', 900);
        if (e.id === myId) { ui.banner('DIZZY!', '', '#ef767a', 900); fx.addShake(0.3); }
        break;
      }
      case 'spawn': {
        dead.delete(e.id);
        fx.puff(e.x, e.y, e.z, 10, 0xffffff, 0.22);
        if (e.id === myId) {
          camTarget.set(e.x, e.y, e.z); // respawns are across the map: cut, don't pan
          ui.banner('GO!', '', '#ffd23f', 700);
        }
        break;
      }
      case 'bounce': {
        const sp = spatial(e.x, e.z, L.x, L.z);
        if (sp.vol > 0.1) sfx.bounce(sp.vol, sp.pan);
        break;
      }
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
    fpsFrames++; fpsT += dt;
    adaptResolution(world, dt);
    if (fpsT >= 1) { fps = fpsFrames; fpsFrames = 0; fpsT = 0; }

    // Fixed 60Hz simulation for the local player (inputs are sent at the same rate)
    if (mode === 'match') {
      acc += dt;
      let n = 0;
      while (acc >= TICK_DT && n < 8) { fixedStep(); acc -= TICK_DT; n++; }
      if (n === 8) acc = 0;
    }

    // Hitstop: hold the visuals for a beat (the sim keeps running underneath)
    if (fx.hitstop > 0) { fx.hitstop -= dt; dt *= 0.08; }

    if (mode === 'match') renderMatch(dt);
    else renderIdle(dt);

    fx.update(dt);
    for (let i = slices.length - 1; i >= 0; i--) { slices[i].update(dt); if (slices[i].done) slices.splice(i, 1); }

    const ns = cn.stats;
    // Netgraph: how we're connected and what the network is doing to us (totals this match)
    ui.debug(debugOn ? `${net.transport.toUpperCase()} · ping ${net.rtt.toFixed(0)}ms · others ${Math.round(cn.delay * TICK_DT * 1000)}ms behind\n`
      + `late snapshots ${ns.gaps} (worst ${Math.round(ns.maxGap)}ms) · frozen ${(ns.starvedMs / 1000).toFixed(1)}s\n`
      + `corrections ${ns.corrections} · teleports ${ns.teleports} · unacked ${cn.pending.length}\n`
      + `fps ${fps} · tick ${cn.latest?.tick ?? "-"} · draws ${world.renderer.info.render.calls} · tris ${(world.renderer.info.render.triangles / 1000).toFixed(0)}k\ndpr ${world.renderer.getPixelRatio().toFixed(2)} · js ${jsMs.toFixed(1)}ms · render ${renderMs.toFixed(1)}ms` : null);
    const tRender = performance.now();
    world.renderer.render(world.scene, world.camera);
    // Smoothed CPU cost per frame: game logic vs. submitting the render (shown in the P HUD)
    jsMs = jsMs * 0.95 + (tRender - now) * 0.05;
    renderMs = renderMs * 0.95 + (performance.now() - tRender) * 0.05;
    requestAnimationFrame(frame);
  }

  // Dev: ?cam=x,z,dist parks the camera and hides the UI (map screenshots)
  const devCam = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
  if (devCam) ui.root.style.display = 'none';
  // Dev: &players=N previews the map size that many players get
  const devPlayers = Number(new URLSearchParams(location.search).get('players'));
  if (devCam && devPlayers > 0) setMap(world, mapFor(roofsForPlayers(devPlayers)));

  function renderIdle(dt: number): void {
    if (devCam) { aimCamera(world, devCam[0], 0, devCam[1], devCam[2] || CAMERA_DIST); return; }
    // Title/lobby backdrop: drift slowly across the rooftops
    titleT += dt;
    const x = Math.sin(titleT * 0.05) * 18, z = -4 + Math.cos(titleT * 0.035) * 9;
    aimCamera(world, x, 1, z, CAMERA_DIST + 6);
  }

  function renderMatch(dt: number): void {
    cn.advance(dt, performance.now());
    playEvents(cn.dueEvents(performance.now()));
    timeLeft = Math.max(0, timeLeft - dt);

    const remote = cn.interpolate();
    const me = cn.latest?.me ?? null;
    const pred = cn.pred;
    const at = pred ? cn.drawPos(acc / TICK_DT) : null; // our player, smoothed between ticks
    const shown = new Set<number>();

    // Local player from prediction (+ decaying correction offset)
    const myChar = chars.get(myId);
    const meAlive = !!me && (me.alive || cn.deathPending()); // keep showing us until our death plays
    if (myChar && pred && at && meAlive && !dead.has(myId)) {
      myChar.root.visible = !remote.get(myId)?.prot || Math.floor(performance.now() / 90) % 2 === 0;
      myChar.root.position.set(at.x, at.y, at.z);
      myChar.root.rotation.y = lerpAngle(myChar.root.rotation.y, pred.facing, Math.min(1, dt * 20));
      const charging = aimHeld > 0 ? Math.min(1, aimHeld / NADE_CHARGE_TIME) : 0;
      myChar.setNade(charging > 0 ? aimKind : null);
      myChar.setRole(me.role);
      myChar.update(dt, {
        speed: Math.hypot(pred.vx, pred.vz), vy: pred.vy, grounded: pred.grounded, lunge: pred.lunge,
        aiming: charging, frozen: me.frozen > 0, chilled: me.chilled > 0, stunned: me.stun > 0,
        ground: world.map.heightAt(at.x, at.z),
      });
      if (charging > 0) fx.showArc(at.x, at.y, at.z, pred.facing, pred.vx, pred.vz, charging); else fx.hideArc();
      shown.add(myId);
    } else {
      fx.hideArc();
      if (myChar) myChar.root.visible = false;
    }

    for (const [id, p] of remote) {
      if (id === myId) continue;
      const c = ensureChar(id);
      const vis = p.visible && p.alive && !dead.has(id);
      // Spawn protection: blink
      c.root.visible = vis && (!p.prot || Math.floor(performance.now() / 90) % 2 === 0);
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
    for (const [id, c] of chars) if (!remote.has(id) && id !== myId) c.root.visible = false;

    const snap = cn.buffer.at(-1)?.snap;
    if (snap) {
      fx.syncProjectiles(snap.projectiles, dt);
      // Weak planks: shake, collapse, rebuild (with sound when it's near)
      for (const ch of updatePlanks(world, snap.planks, dt)) {
        const br = world.map.bridges[ch.i];
        const sp = spatial((br.x0 + br.x1) / 2, (br.z0 + br.z1) / 2, camTarget.x, camTarget.z);
        if (ch.to === 1) sfx.creak(sp.vol, sp.pan);
        if (ch.to === 2) { sfx.crash(sp.vol, sp.pan); fx.puff((br.x0 + br.x1) / 2, br.h, (br.z0 + br.z1) / 2, 8, 0xc9a27c, 0.2); }
      }
    }

    // Camera: follow me, or whoever I'm spectating
    let fx0 = camTarget.x, fy0 = camTarget.y, fz0 = camTarget.z, lookVx = 0, lookVz = 0;
    if (pred && at && meAlive) {
      fx0 = at.x; fy0 = at.y; fz0 = at.z; lookVx = pred.vx; lookVz = pred.vz;
    } else if (gameMode === 'tag') {
      if (spectate === null || !remote.get(spectate)?.alive) spectate = nextSpectate();
      const sp = spectate !== null ? remote.get(spectate) : undefined;
      if (sp) { fx0 = sp.x; fy0 = sp.y; fz0 = sp.z; lookVx = sp.vx; lookVz = sp.vz; }
    }
    const k = 1 - Math.exp(-dt * 6);
    camTarget.x += (fx0 + lookVx * 0.25 - camTarget.x) * k;
    camTarget.y += (Math.max(0, fy0) - camTarget.y) * k * 0.5;
    camTarget.z += (fz0 + lookVz * 0.2 - camTarget.z) * k;
    const shake = fx.shake * fx.shake;
    aimCamera(world,
      camTarget.x + (Math.random() - 0.5) * shake, camTarget.y, camTarget.z + (Math.random() - 0.5) * shake,
      CAMERA_DIST * (1 - fx.zoomPunch * 2));

    // Name labels
    const v = new THREE.Vector3();
    for (const id of shown) {
      const c = chars.get(id)!;
      v.set(c.root.position.x, c.root.position.y + 1.45, c.root.position.z).project(world.camera);
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth, sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      const role = id === myId ? me?.role : remote.get(id)?.role;
      // Everyone (you too) wears their team colour
      const color = role === 'tagger' ? hex(COLOR_TAGGER) : '#14bfa0';
      ui.label(id, sx, sy, id === myId ? 'YOU' : ui.nameOf(id), color);
    }
    ui.hideLabelsExcept(shown);

    // HUD
    if (me) {
      const teams = Object.entries(roles).map(([id, role]) => ({ id: Number(id), role, alive: !dead.has(Number(id)) }));
      const hud: HudState = {
        phase, timeLeft, role: me.role, alive: me.alive, frozen: me.frozen, blind: me.blind,
        nades: me.nades, teams,
        spectating: gameMode === 'tag' && !me.alive && spectate !== null ? ui.nameOf(spectate) : null,
        mode: gameMode,
        respawn: me.respawn,
      };
      ui.updateHud(hud);
    }
    const tab = isHeld('Tab');
    if (tab !== boardHeld || tab) ui.showBoard(tab, standings, myId);
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
