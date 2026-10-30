// Is our own player drawn smoothly? Real server Match + real client netcode, a frame loop at
// 60Hz and 120Hz (with requestAnimationFrame-like jitter), holding "run" on open roof. Smooth
// = each frame moves the character in proportion to the frame's time. Prints how uneven the
// speed on screen is (coefficient of variation of per-frame speed; 0 = perfectly smooth) for
// the drawn position, next to drawing the latest tick as-is.
// Run: npx tsx scripts/check-smooth.ts
import { Match } from '../src/server/match';
import { ClientNet } from '../src/client/netcode';
import { roofsForPlayers } from '../src/shared/map';
import { TICK_DT } from '../src/shared/constants';
import type { ServerMessage, Snapshot } from '../src/shared/protocol';

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };
let seed = 7;
Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function cv(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / m;
}

for (const hz of [60, 120]) {
  const roster = [1, 2].map(id => ({ id, name: `p${id}`, character: id, ready: true, bot: id === 2 }));
  const inbox: { at: number; msg: ServerMessage }[] = [];
  let now = 0;
  const m = new Match({ send(_id, msg) { inbox.push({ at: now + 20, msg }); }, onMatchEnd() {} }, roster, 'dm', roofsForPlayers(2));
  const M = m as unknown as { startRound(first: boolean): void; step(): void; phase: string; timeLeft: number };
  M.startRound(true);
  M.phase = 'chase'; M.timeLeft = 999;
  m.removePlayer(2);
  const me = m.players[0];
  // A straight clear lane across the plaza (no obstacle within a body's width), run along +x
  let lane = NaN;
  for (let z = -10; z <= 4 && Number.isNaN(lane); z += 0.25) {
    let clear = true;
    for (let x = -6; x <= 6 && clear; x += 0.1) for (const dz of [-0.6, 0, 0.6]) if (m.map.heightAt(x, z + dz) !== 0) clear = false;
    if (clear) lane = z;
  }
  me.body.x = -6; me.body.z = lane; me.body.y = 0;
  const cn = new ClientNet(m.map);
  cn.myId = 1;
  let acc = 0, nextTick = 0, nextFrame = 0;
  const drawn: number[] = [], raw: number[] = [];
  let lastDrawn: number | null = null, lastRaw: number | null = null;
  while (now < 3000) {
    now = Math.min(nextTick, nextFrame);
    if (now === nextTick) { M.step(); nextTick += TICK_DT * 1000; continue; }
    // A frame: ~1/hz with jitter, like rAF on a busy page
    const dt = (1000 / hz) * (0.85 + Math.random() * 0.3) / 1000;
    nextFrame = now + dt * 1000;
    while (inbox.length && inbox[0].at <= now) { const { msg } = inbox.shift()!; if (msg.type === 'snap') cn.onSnapshot(msg as Snapshot, now); }
    acc += dt;
    while (acc >= TICK_DT) {
      acc -= TICK_DT;
      const step = cn.predict({ mx: 1, mz: 0, b: 0 });
      if (step) m.pushInput(1, step.msg.seq, { mx: 1, mz: 0, b: 0 }, step.msg.v);
    }
    cn.advance(dt, now);
    if (!cn.pred || now < 400 || now > 1800) continue; // at full speed, still in the lane
    const d = cn.drawPos(acc / TICK_DT).x, r = cn.pred.x + cn.err.x;
    if (lastDrawn !== null) { drawn.push(Math.abs(d - lastDrawn) / dt); raw.push(Math.abs(r - lastRaw!) / dt); }
    lastDrawn = d; lastRaw = r;
  }
  console.log(`  frames sampled ${drawn.length}, snapshots ${cn.stats.snaps}, lane z=${lane}, ran to x=${cn.pred?.x.toFixed(1)}`);
  console.log(`${hz}Hz: speed on screen varies ${(cv(drawn) * 100).toFixed(1)}% frame to frame (latest tick as-is: ${(cv(raw) * 100).toFixed(1)}%)`);
  check(cv(drawn) < 0.05, `${hz}Hz: our player moves smoothly`);
}
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
