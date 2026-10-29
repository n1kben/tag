// Server input handling: every input runs once, in order; stalls and bursts don't leave a
// player stuck or permanently behind; nobody runs faster than real time.
// Run: npx tsx scripts/check-inputs.ts
import { Match, type MPlayer } from '../src/server/match';
import { roofsForPlayers } from '../src/shared/map';
import { RUN_SPEED, TICK_DT } from '../src/shared/constants';

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

/** A 2-player room in the chase phase with a human (id 1) on open roof, and a step function. */
function setup() {
  const roster = [1, 2].map(id => ({ id, name: `p${id}`, character: id, ready: true, bot: id === 2 }));
  const m = new Match({ send() {}, onMatchEnd() {} }, roster, 'dm', roofsForPlayers(2));
  const I = m as unknown as { startRound(first: boolean): void; step(): void; phase: string; timeLeft: number; tick: number };
  I.startRound(true);
  I.phase = 'chase'; I.timeLeft = 999;
  const me = m.players[0] as MPlayer;
  const bot = m.players[1] as MPlayer;
  bot.alive = false; // out of the way
  me.role = 'runner';
  me.body.x = 0; me.body.z = -3; me.body.vx = me.body.vz = 0;
  let seq = 0;
  const send = (n = 1) => { for (let i = 0; i < n; i++) m.pushInput(1, ++seq, { mx: 0, mz: -1, b: 0 }, I.tick); };
  return { m, I, me, send, seq: () => seq };
}

// 1) Silent for 2s (no snapshot yet, tab hidden...), then one input per tick: moves at once
{
  const { I, me, send } = setup();
  for (let t = 0; t < 120; t++) I.step();
  const z0 = me.body.z;
  for (let t = 0; t < 30; t++) { send(); I.step(); }
  check(z0 - me.body.z > 1.5, `after 2s of silence, steady input moves us straight away (${(z0 - me.body.z).toFixed(2)}m in 0.5s)`);
}

// 2) Network stall: 0.4s of nothing, then the backlog arrives at once, then steady again
{
  const { I, me, send, seq } = setup();
  for (let t = 0; t < 30; t++) { send(); I.step(); }
  for (let t = 0; t < 24; t++) I.step(); // inputs for these ticks are stuck in the network
  send(24); // …and arrive together
  for (let t = 0; t < 60; t++) { send(); I.step(); }
  const behind = seq() - me.ack;
  check(behind <= 2, `after a stall + burst the server catches up (${behind} inputs behind)`);
}

// 3) Speed hack: twice as many inputs as ticks for 3s
{
  const { I, me, send } = setup();
  const z0 = me.body.z;
  for (let t = 0; t < 180; t++) { send(2); I.step(); }
  const dist = z0 - me.body.z, max = RUN_SPEED * 180 * TICK_DT * 1.05 + 1.2; // + the 1s bank
  check(dist <= max, `sending 2x inputs doesn't outrun real time (${dist.toFixed(1)}m in 3s, max ${max.toFixed(1)})`);
}
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
