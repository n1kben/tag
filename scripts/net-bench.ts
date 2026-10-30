// Network bench: the real server Match and real client netcode (src/client/netcode.ts), wired
// through a simulated network on a simulated clock. Each client is played by the bot brain,
// but it decides from what that client sees (its prediction + its interpolated view of the
// others), so chases, swings and deaths happen the way they would for a human on that line.
//
// Run: npx tsx scripts/net-bench.ts [profile|all] [seconds=170] [runs=6] [clients=6] [bots=2] [tcp|udp|both]
// Each profile plays `runs` deathmatches (seeds 1..runs) and adds them up.
// Profiles are one-way delay ± jitter with packet loss. tcp = WebSocket: ordered, and a lost
// packet holds up everything behind it until it's resent. udp = the WebRTC data channel:
// snapshots and inputs unreliable (lost is lost, may reorder; each input packet repeats the
// last 3 inputs), events and round messages still on the reliable WebSocket.
//
// What it prints (per minute where it says /min):
//   delay    how far behind the server others are drawn (average)
//   corr     reconciles that moved your own player >0.3m      (rubber-banding)
//   tele     …more than 1m                                     (teleports)
//   frozen   share of time others were drawn past the newest snapshot (they freeze, then jump)
//   gaps     snapshots that arrived >100ms after the previous one
//   gap50/95 victim's view: distance between your body and the tagger's at the moment you're
//            shown dying (median / 95th percentile; 0 = touching)  ("killed from far away")
//   hit%     attacker's view: swings that touched the target on your screen and killed
//   phantom  kills where the attacker's screen showed a clear gap at the swing
//   drop/wait server: inputs thrown away / ticks with no input to run, per player per minute
import { Match, type MatchHost } from '../src/server/match';
import { Brain } from '../src/server/bots';
import { ClientNet } from '../src/client/netcode';
import { roofsForPlayers } from '../src/shared/map';
import type { Input } from '../src/shared/sim';
import { TICK_DT, PLAYER_RADIUS, STAB_RANGE, STAB_ARC_COS } from '../src/shared/constants';
import type { GameEvent, LobbyPlayer, ServerMessage, Snapshot } from '../src/shared/protocol';
import { encodeSnapshot, decodeSnapshot } from '../src/shared/wire';

interface Profile { name: string; delay: number; jitter: number; loss: number }
const PROFILES: Profile[] = [
  { name: 'lan', delay: 1, jitter: 0, loss: 0 },
  { name: 'good', delay: 15, jitter: 4, loss: 0 },
  { name: 'typical', delay: 40, jitter: 12, loss: 0.005 },
  { name: 'bad', delay: 75, jitter: 30, loss: 0.02 },
];

const [profArg = 'all', secArg = '170', runArg = '6', clientArg = '6', botArg = '2', transArg = 'tcp'] = process.argv.slice(2);
const TRANSPORTS = transArg === 'both' ? ['tcp', 'udp'] : [transArg];
const INPUT_REDUNDANCY = 3;
let UDP = false;
const SECONDS = Number(secArg), RUNS = Number(runArg), CLIENTS = Number(clientArg), BOTS = Number(botArg);

// Deterministic randomness: the bench must give the same numbers for the same code
let seed = 1;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
Math.random = rand; // bots, spawns and the map use Math.random

/**
 * One direction of a connection. Reliable (TCP): in order; a lost packet is resent and blocks
 * the rest. Unreliable (UDP): a lost packet is gone, and packets can overtake each other.
 */
class Link<T> {
  private q: { at: number; msg: T }[] = [];
  private lastAt = 0;
  constructor(private p: Profile, private reliable = true) {}
  send(msg: T, now: number): void {
    let at = now + this.p.delay + rand() * this.p.jitter;
    const lost = rand() < this.p.loss;
    if (!this.reliable) {
      if (lost) return;
      this.q.push({ at, msg });
      this.q.sort((a, b) => a.at - b.at);
      return;
    }
    // Lost: fast retransmit after a round trip plus a few more packets' worth of duplicate acks
    if (lost) at += this.p.delay * 2 + 100;
    at = Math.max(at, this.lastAt);
    this.lastAt = at;
    this.q.push({ at, msg });
  }
  poll(now: number): T[] {
    const out: T[] = [];
    while (this.q.length && this.q[0].at <= now) out.push(this.q.shift()!.msg);
    return out;
  }
}

type InputPacket = { seq: number; input: Input; v: number }[];

interface Client {
  id: number;
  cn: ClientNet;
  brain: Brain;
  down: Link<ServerMessage>; // reliable (WebSocket)
  snaps: Link<ServerMessage>; // snapshots: the WebSocket too (tcp) or the data channel (udp)
  up: Link<InputPacket>;
  nextFrame: number;
  acc: number;
  contact: { target: number; at: number } | null; // last swing that touched someone on our screen
  lastSwingGap: number;
}

interface Totals {
  corr: number; tele: number; starvedMs: number; gaps: number; snaps: number;
  killGaps: number[]; contactSwings: number; contactHits: number; phantom: number; kills: number;
  dropped: number; starved: number;
  delaySum: number; delayN: number;
}

function median(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function run(profile: Profile, transport: string, runSeed: number, tot: Totals): void {
  seed = runSeed * 7919;
  const roster: LobbyPlayer[] = [];
  for (let i = 1; i <= CLIENTS + BOTS; i++) roster.push({ id: i, name: `p${i}`, character: i, ready: true, bot: i > CLIENTS });
  const clients = new Map<number, Client>();
  let now = 0;

  const host: MatchHost = {
    // Snapshots go through the wire codec, so its rounding is part of what we measure
    send(id, msg) {
      const c = clients.get(id);
      if (msg.type === 'snap') c?.snaps.send(decodeSnapshot(encodeSnapshot(msg)), now);
      else c?.down.send(msg, now);
    },
    onMatchEnd() {},
  };
  // Deathmatch: continuous play with both sides swapping, so everyone gets to tag and be tagged
  const m = new Match(host, roster, 'dm', roofsForPlayers(roster.length));
  for (let i = 1; i <= CLIENTS; i++) {
    clients.set(i, {
      id: i, cn: new ClientNet(m.map), brain: new Brain(),
      down: new Link(profile), up: new Link(profile, transport === 'tcp'), snaps: new Link(profile, transport === 'tcp'),
      nextFrame: rand() * 16, acc: 0, contact: null, lastSwingGap: Infinity,
    });
    clients.get(i)!.cn.myId = i;
  }
  const M = m as unknown as { startRound(first: boolean): void; step(): void; phase: string };
  M.startRound(true);

  const endMs = SECONDS * 1000;
  let nextTick = 0;
  while (now < endMs) {
    // Next thing to happen: a server tick or a client frame
    const nextClient = Math.min(...[...clients.values()].map(c => c.nextFrame));
    now = Math.min(nextTick, nextClient);
    if (now === nextTick) {
      for (const c of clients.values()) for (const pk of c.up.poll(now)) for (const u of pk) m.pushInput(c.id, u.seq, u.input, u.v);
      M.step();
      nextTick += TICK_DT * 1000;
      continue;
    }
    for (const c of clients.values()) {
      if (c.nextFrame > now) continue;
      // ~60fps with a little frame-time noise, like requestAnimationFrame
      const dt = (1000 / 60 + (rand() - 0.5) * 3) / 1000;
      c.nextFrame = now + dt * 1000;
      frame(c, dt, now, tot);
    }
  }
  for (const c of clients.values()) {
    const s = c.cn.stats;
    tot.corr += s.corrections; tot.tele += s.teleports; tot.starvedMs += s.starvedMs; tot.gaps += s.gaps; tot.snaps += s.snaps;
  }
  for (const p of m.players) if (!p.bot) { tot.dropped += p.net.dropped; tot.starved += p.net.waited; }
}

/** What one client's screen shows: its own predicted body and everyone else interpolated. */
function viewOf(c: Client) {
  const cn = c.cn, s = cn.latest!, me = s.me!;
  const others = [...cn.interpolate().values()].filter(p => p.id !== c.id && p.visible);
  const pred = cn.pred!;
  return {
    map: cn.map, phase: s.phase,
    broken: new Set(s.planks.flatMap((st, i) => (st === 2 ? [i] : []))),
    me: {
      id: c.id, alive: me.alive, connected: true, role: me.role, prot: 0, body: { ...pred, x: pred.x + cn.err.x, z: pred.z + cn.err.z },
      nades: me.nades, chilled: me.chilled, frozen: me.frozen, blind: me.blind,
    },
    others: others.map(p => ({
      id: p.id, alive: p.alive, connected: true, role: p.role, prot: p.prot ? 1 : 0,
      body: { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, facing: p.f },
    })),
  };
}

function gapTo(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z) - PLAYER_RADIUS * 2;
}

function frame(c: Client, dt: number, now: number, tot: Totals): void {
  const cn = c.cn;
  // Both links feed the same handler; over tcp they'd be one socket, but order within each holds
  for (const msg of [...c.down.poll(now), ...c.snaps.poll(now)]) {
    if (msg.type === 'snap') cn.onSnapshot(msg as Snapshot, now);
    else if (msg.type === 'round_start') { cn.newRound(); c.brain.reset(); }
    else if (msg.type === 'ev') for (const e of cn.pushEvents(msg.tick, msg.events, now)) onEvent(c, e, now, tot);
  }
  c.acc += dt;
  while (c.acc >= TICK_DT) {
    c.acc -= TICK_DT;
    if (!cn.latest?.me || !cn.pred) continue;
    const v = viewOf(c);
    const input: Input = v.me.alive
      ? c.brain.think({ map: v.map, phase: v.phase, broken: v.broken, players: [v.me, ...v.others] } as never, v.me as never)
      : { mx: 0, mz: 0, b: 0 };
    const step = cn.predict(input);
    if (!step) continue;
    // tcp: one input per message; udp: each packet repeats the last few, so a lost one costs nothing
    const n = UDP ? INPUT_REDUNDANCY : 1;
    c.up.send(cn.pending.slice(-n).map(p => ({ seq: p.seq, input: p.input, v: p.v })), now);
    if (step.ev.lunged) {
      // Did this swing touch an enemy on our screen?
      const pred = cn.pred!;
      const fx = Math.sin(pred.facing), fz = Math.cos(pred.facing);
      let best: { id: number; gap: number } | null = null;
      for (const o of v.others) {
        if (!o.alive || o.role === v.me.role || o.prot) continue;
        const dx = o.body.x - pred.x, dz = o.body.z - pred.z, d = Math.hypot(dx, dz);
        if (Math.abs(o.body.y - pred.y) > 1.2 || (d > 0.3 && (dx * fx + dz * fz) / d < STAB_ARC_COS)) continue;
        const g = gapTo(pred, o.body);
        if (!best || g < best.gap) best = { id: o.id, gap: g };
      }
      c.lastSwingGap = best?.gap ?? Infinity;
      if (best && best.gap <= STAB_RANGE) { tot.contactSwings++; c.contact = { target: best.id, at: now }; }
    }
  }
  cn.advance(dt, now);
  for (const e of cn.dueEvents(now)) onEvent(c, e, now, tot);
  if (cn.buffer.length) { tot.delaySum += cn.delay; tot.delayN++; }
}

function onEvent(c: Client, e: GameEvent, now: number, tot: Totals): void {
  if (e.k !== 'kill' || e.by === null || e.cause !== 'stab') return;
  if (e.by === c.id) {
    tot.kills++;
    if (c.contact && c.contact.target === e.id && now - c.contact.at < 600) { tot.contactHits++; c.contact = null; }
    if (c.lastSwingGap > STAB_RANGE + 0.3) tot.phantom++;
  }
  if (e.id === c.id && c.cn.pred) {
    // The victim's screen at the moment the death is shown
    const view = c.cn.interpolate().get(e.by);
    const pred = c.cn.pred;
    if (view) tot.killGaps.push(Math.max(0, gapTo({ x: pred.x + c.cn.err.x, z: pred.z + c.cn.err.z }, view)));
  }
}

const list = profArg === 'all' ? PROFILES : PROFILES.filter(p => p.name === profArg);
if (!list.length) { console.log(`unknown profile ${profArg}; one of ${PROFILES.map(p => p.name).join(', ')}, all`); process.exit(1); }
const mins = (SECONDS * RUNS) / 60;
console.log(`${CLIENTS} clients + ${BOTS} bots, ${RUNS} × ${SECONDS}s deathmatches per profile`);
console.log('profile   net rtt      delay  corr/min tele/min frozen  gaps/min gap50  gap95  hit%   phantom kills  drop/min wait/min');
for (const transport of TRANSPORTS) for (const p of list) {
  UDP = transport === 'udp';
  const t0 = performance.now();
  const r: Totals = { corr: 0, tele: 0, starvedMs: 0, gaps: 0, snaps: 0, killGaps: [], contactSwings: 0, contactHits: 0, phantom: 0, kills: 0, dropped: 0, starved: 0, delaySum: 0, delayN: 0 };
  for (let i = 1; i <= RUNS; i++) run(p, transport, i, r);
  const per = (n: number) => (n / CLIENTS / mins).toFixed(1).padStart(8);
  console.log([
    p.name.padEnd(9),
    transport,
    `${p.delay * 2}±${p.jitter}`.padEnd(8),
    `${Math.round((r.delaySum / Math.max(1, r.delayN)) * TICK_DT * 1000)}ms`.padStart(6),
    per(r.corr), per(r.tele),
    `${((r.starvedMs / CLIENTS / (SECONDS * RUNS * 1000)) * 100).toFixed(1)}%`.padStart(6),
    per(r.gaps),
    median(r.killGaps, 0.5).toFixed(2).padStart(6), median(r.killGaps, 0.95).toFixed(2).padStart(6),
    `${r.contactSwings ? Math.round((r.contactHits / r.contactSwings) * 100) : 0}%`.padStart(5),
    String(r.phantom).padStart(7), String(r.kills).padStart(5),
    per(r.dropped), per(r.starved),
    `  (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
  ].join(' '));
}
