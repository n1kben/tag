// Grenade refill for staying alive, through the real server tick.
// Run: npx tsx scripts/check-refill.ts
import { Match, type MPlayer } from '../src/server/match';
import { roofsForPlayers } from '../src/shared/map';
import { NADE_LOADOUT, NADE_REFILL_EVERY, TICK_DT } from '../src/shared/constants';
import type { GameEvent } from '../src/shared/protocol';

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

function setup() {
  const roster = [1, 2].map(id => ({ id, name: `p${id}`, character: id, ready: true, bot: false }));
  const events: GameEvent[] = [];
  const m = new Match({ send(id, msg) { if (id === 1 && msg.type === 'ev') events.push(...msg.events); }, onMatchEnd() {} }, roster, 'dm', roofsForPlayers(2));
  const I = m as unknown as { startRound(first: boolean): void; step(): void; phase: string; timeLeft: number };
  I.startRound(true);
  I.phase = 'chase'; I.timeLeft = 999;
  const me = m.players[0] as MPlayer;
  m.players[1].alive = false; m.players[1].respawnT = 0; // nobody to tag us
  me.role = 'runner';
  const run = (secs: number) => { for (let t = 0; t < secs; t += TICK_DT) I.step(); };
  return { I, me, events, run };
}

{
  const { me, events, run } = setup();
  me.nades = { flash: 0, frost: 0 };
  run(NADE_REFILL_EVERY - 0.5);
  check(me.nades.flash + me.nades.frost === 0, `nothing before ${NADE_REFILL_EVERY}s`);
  run(1);
  check(me.nades.frost === 1 && me.nades.flash === 0 && me.nadeSel === 'frost', 'first one back is frost, and it gets selected');
  check(events.some(e => e.k === 'refill' && e.id === 1 && e.kind === 'frost'), 'the client is told (refill event)');
  run(NADE_REFILL_EVERY * 2);
  check(me.nades.flash === 2 && me.nades.frost === 1, `then flashes, up to the kit (${me.nades.flash} flash, ${me.nades.frost} frost)`);
  run(NADE_REFILL_EVERY * 2);
  check(me.nades.flash === NADE_LOADOUT.flash && me.nades.frost === NADE_LOADOUT.frost, 'never more than the kit');
}
{
  const { I, me, run } = setup();
  me.nades = { flash: 0, frost: 0 };
  I.phase = 'start'; I.timeLeft = 999;
  run(NADE_REFILL_EVERY + 1);
  check(me.nades.flash + me.nades.frost === 0, 'no refills during the head start');
}
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
