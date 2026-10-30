// Aiming a grenade plants your feet: the move keys only turn you, and the throw goes that way.
// Run: npx tsx scripts/check-aim.ts
import { newBody, stepBody, BTN_ACTION, BTN_FLASH, BTN_JUMP, type Body } from '../src/shared/sim';
import type { GameMap } from '../src/shared/map';
import { Match, type MPlayer } from '../src/server/match';
import { roofsForPlayers } from '../src/shared/map';
import { TICK_DT, RUN_SPEED } from '../src/shared/constants';

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };
const runner = { role: 'runner' as const, frozen: false, chilled: false, locked: false };
const tagger = { ...runner, role: 'tagger' as const };
const FLAT = { solids: [], bridges: [], heightAt: () => 0 } as unknown as GameMap;
const AIM = BTN_ACTION | BTN_FLASH;
const step = (b: Body, mx: number, mz: number, btn: number, st = runner) => stepBody(FLAT, b, { mx, mz, b: btn }, st, TICK_DT);
const ticks = (secs: number) => Math.round(secs / TICK_DT);

{
  const b = newBody(FLAT, 0, 0);
  for (let i = 0; i < ticks(0.5); i++) step(b, 1, 0, AIM);
  check(Math.abs(b.x) < 1e-6 && Math.abs(b.z) < 1e-6, `standing + aiming + holding right → doesn't move (x=${b.x.toFixed(3)})`);
  check(Math.abs(b.facing - Math.PI / 2) < 1e-6, 'but turns to face right');
  step(b, 0, -1, AIM);
  check(Math.abs(Math.abs(b.facing) - Math.PI) < 1e-6, 'and swings to face up the next tick');
}
{
  const b = newBody(FLAT, 0, 0);
  for (let i = 0; i < ticks(1); i++) step(b, 1, 0, 0);
  const x0 = b.x;
  check(b.vx > RUN_SPEED * 0.9, `running right at full speed (${b.vx.toFixed(1)})`);
  for (let i = 0; i < ticks(0.5); i++) step(b, 1, 0, AIM);
  check(Math.hypot(b.vx, b.vz) < 0.1, `start aiming mid-run → slides to a stop (${Math.hypot(b.vx, b.vz).toFixed(3)} m/s)`);
  check(b.x - x0 < 1.5, `with a short slide (${(b.x - x0).toFixed(2)} m)`);
  for (let i = 0; i < ticks(0.3); i++) step(b, 1, 0, 0);
  check(b.vx > 1, 'let go → runs again');
}
{
  const b = newBody(FLAT, 0, 0);
  for (let i = 0; i < ticks(1); i++) step(b, 1, 0, 0);
  step(b, 1, 0, BTN_JUMP);
  const v0 = b.vx;
  for (let i = 0; i < 5; i++) step(b, 0, 1, AIM | BTN_JUMP);
  check(!b.grounded && Math.abs(b.vx - v0) < 1e-6 && Math.abs(b.vz) < 1e-6, 'aiming in the air keeps your momentum, no steering');
}
{
  const b = newBody(FLAT, 0, 0);
  for (let i = 0; i < ticks(0.5); i++) step(b, 1, 0, AIM, tagger);
  check(b.x > 1, 'taggers holding J still run');
}

// Through the real server: aim right while standing, release → grenade flies right, thrower stays put
{
  const roster = [1, 2].map(id => ({ id, name: `p${id}`, character: id, ready: true, bot: false }));
  const m = new Match({ send() {}, onMatchEnd() {} }, roster, 'dm', roofsForPlayers(2));
  const I = m as unknown as { startRound(first: boolean): void; step(): void; phase: string; timeLeft: number; projectiles: { vx: number; vz: number }[] };
  I.startRound(true);
  I.phase = 'chase'; I.timeLeft = 999;
  const me = m.players[0] as MPlayer;
  m.players[1].alive = false; m.players[1].respawnT = 0;
  me.role = 'runner';
  me.nades = { flash: 1, frost: 0 };
  let seq = me.lastSeq;
  const send = (mx: number, mz: number, b: number) => { m.pushInput(1, ++seq, { mx, mz, b }); I.step(); };
  for (let i = 0; i < 30; i++) send(0, 0, 0); // settle on the roof
  const x0 = me.body.x, z0 = me.body.z;
  for (let i = 0; i < ticks(0.4); i++) send(1, 0, AIM);
  check(Math.hypot(me.body.x - x0, me.body.z - z0) < 0.01, `server: aiming right doesn't move you (${Math.hypot(me.body.x - x0, me.body.z - z0).toFixed(3)} m)`);
  send(1, 0, 0);
  const p = I.projectiles[0];
  check(!!p && p.vx > 5 && Math.abs(p.vz) < 0.01, `server: release → flash flies right (vx=${p?.vx.toFixed(1)}, vz=${p?.vz.toFixed(2)})`);
}

console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
