// Invariant checks for team Deathmatch over full bot matches: team sizes stay fixed, a catch swaps
// exactly that pair, the caught hider comes back as a seeker, hiders earn survival points.
// Run: npx tsx scripts/check-dm.ts [bots=6] [matches=3]
import { Match } from '../src/server/match';
import type { GameEvent, LobbyPlayer } from '../src/shared/protocol';

const n = Number(process.argv[2] ?? 6), runs = Number(process.argv[3] ?? 3);
let failures = 0;
const fail = (msg: string) => { if (failures++ < 10) console.log('FAIL', msg); };

for (let run = 0; run < runs; run++) {
  const roster: LobbyPlayer[] = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `b${i + 1}`, character: i, ready: true, bot: true }));
  roster.push({ id: 99, name: 'watcher', character: 9, ready: true, bot: false }); // receives events
  const events: GameEvent[] = [];
  let ended = false;
  const m = new Match({
    send(_id, msg) {
      if (msg.type === 'ev') events.push(...msg.events);
      if (msg.type === 'match_end') ended = true;
    },
    onMatchEnd() {},
  }, roster, 'dm');
  const I = m as unknown as { step(): void; startRound(first: boolean): void };
  I.startRound(true);
  // The silent "human" is a dead bystander: keep them out of play
  const w = m.players.find(p => p.id === 99)!;
  w.connected = false;
  w.alive = false; // spawned by startRound; bench them so bots can't catch the bystander
  const seekers0 = m.players.filter(p => p.connected && p.role === 'seeker').length;

  let drifted = false;
  let catches = 0, swapsOk = 0, respawnedAsSeeker = 0, ticks = 0;
  const awaitingSeekerRespawn = new Set<number>();
  while (!ended && ticks < 60 * 60 * 5) {
    const rolesBefore = new Map(m.players.map(p => [p.id, p.role]));
    events.length = 0;
    w.connected = true; // let the watcher receive this tick's events
    I.step();
    w.connected = false;
    ticks++;
    const seekers = m.players.filter(p => p.connected && p.role === 'seeker').length;
    if (seekers !== seekers0 && !drifted) {
      drifted = true;
      fail(`team size drifted: ${seekers0} → ${seekers} seekers at tick ${ticks}`);
      for (const p of m.players) if (rolesBefore.get(p.id) !== p.role) console.log(`   ${p.name} ${rolesBefore.get(p.id)} → ${p.role}`);
      console.log('   events:', JSON.stringify(events.filter(e => e.k === 'kill' || e.k === 'spawn')));
    }
    for (const e of events) {
      if (e.k === 'kill' && e.by !== null && rolesBefore.get(e.by) === 'seeker' && rolesBefore.get(e.id) === 'hider') {
        catches++;
        const killer = m.players.find(p => p.id === e.by)!, victim = m.players.find(p => p.id === e.id)!;
        if (killer.role === 'hider' && victim.role === 'seeker' && killer.nades.flash + killer.nades.frost > 0) swapsOk++;
        else fail(`catch ${e.by}→${e.id} did not swap cleanly`);
        awaitingSeekerRespawn.add(e.id);
      }
      if (e.k === 'spawn' && awaitingSeekerRespawn.delete(e.id)) {
        const p = m.players.find(q => q.id === e.id)!;
        if (p.role === 'seeker' && p.nades.flash + p.nades.frost === 0) respawnedAsSeeker++;
        else fail(`caught player ${e.id} respawned as ${p.role}`);
      }
    }
  }
  const survived = m.players.reduce((s, p) => s + p.survived, 0);
  if (!ended) fail('match never ended');
  if (catches === 0) fail('no catches happened');
  if (survived === 0) fail('no survival points awarded');
  console.log(`match ${run + 1}: ${(ticks / 60).toFixed(0)}s, seekers fixed at ${seekers0}/${n}, catches ${catches} (clean swaps ${swapsOk}), respawned as seeker ${respawnedAsSeeker}, survival points ${survived}`);
  console.log('  standings:', m.standings().filter(s => s.id !== 99).map(s => `${s.name}:${s.score}`).join(' '));
}
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
