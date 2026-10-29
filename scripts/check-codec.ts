// Binary snapshot codec: round-trips real match snapshots. Our own body must come back
// bit-exact (prediction replays from it); everyone else within the quantization; size small
// enough for one UDP packet. Run: npx tsx scripts/check-codec.ts
import { Match } from '../src/server/match';
import { roofsForPlayers } from '../src/shared/map';
import { encodeSnapshot, decodeSnapshot } from '../src/shared/snapcodec';
import type { LobbyPlayer, Snapshot } from '../src/shared/protocol';

let failures = 0;
const fail = (msg: string) => { if (failures++ < 10) console.log('FAIL', msg); };
const UDP_BUDGET = 1100; // bytes: below a typical path MTU after IP/UDP/DTLS/SCTP headers

for (const n of [2, 8, 13]) {
  const roster: LobbyPlayer[] = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `p${i}`, character: i, ready: true, bot: i > 0 }));
  const snaps: Snapshot[] = [];
  const m = new Match({ send(_id, msg) { if (msg.type === 'snap') snaps.push(msg); }, onMatchEnd() {} }, roster, 'dm', roofsForPlayers(n));
  const I = m as unknown as { startRound(first: boolean): void; step(): void };
  I.startRound(true);
  for (let t = 0; t < 60 * 60; t++) I.step();
  let maxBytes = 0;
  for (const s of snaps) {
    const bytes = encodeSnapshot(s);
    maxBytes = Math.max(maxBytes, bytes.length);
    const d = decodeSnapshot(bytes);
    if (d.tick !== s.tick || d.phase !== s.phase || d.ack !== s.ack || Math.abs(d.timeLeft - s.timeLeft) > 0.01) fail(`header ${s.tick}`);
    if (s.me) {
      for (const [k, v] of Object.entries(s.me)) {
        const got = (d.me as unknown as Record<string, unknown>)[k];
        const ok = typeof v === 'object' ? JSON.stringify(v) === JSON.stringify(got)
          : ['frozen', 'chilled', 'blind', 'respawn', 'stun'].includes(k) ? Math.abs((v as number) - (got as number)) < 1e-4
          : v === got;
        if (!ok) fail(`me.${k} ${String(v)} → ${String(got)} (tick ${s.tick})`);
      }
    }
    s.players.forEach((p, i) => {
      const q = d.players[i];
      const angle = Math.abs(Math.atan2(Math.sin(p.f - q.f), Math.cos(p.f - q.f)));
      if (q.id !== p.id || q.alive !== p.alive || q.role !== p.role || q.prot !== p.prot || q.nade !== p.nade) fail(`player ${p.id} flags`);
      if (Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y), Math.abs(q.z - p.z), Math.abs(q.vx - p.vx), Math.abs(q.vz - p.vz)) > 0.006 || angle > 0.02) fail(`player ${p.id} position/facing`);
      if (Math.abs(q.frozen - p.frozen) > 0.03 || Math.abs(q.stun - p.stun) > 0.03 || Math.abs(q.lunge - p.lunge) > 0.001) fail(`player ${p.id} timers`);
    });
    if (JSON.stringify(d.scores) !== JSON.stringify(s.scores) || JSON.stringify(d.planks) !== JSON.stringify(s.planks)) fail('scores/planks');
    if (d.projectiles.length !== s.projectiles.length) fail('projectiles');
  }
  const json = Math.max(...snaps.map(s => JSON.stringify(s).length));
  console.log(`${n} players: ${snaps.length} snapshots, binary max ${maxBytes}B (JSON ${json}B)`);
  if (maxBytes > UDP_BUDGET) fail(`${n} players: ${maxBytes}B doesn't fit one UDP packet (${UDP_BUDGET}B)`);
}
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
