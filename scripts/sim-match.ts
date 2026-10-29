// Runs a full bots-only match as fast as possible and prints what happened.
// Run: npx tsx scripts/sim-match.ts [bots=6] [tag|dm]
import { Match } from '../src/server/match';
import { roofsForPlayers } from '../src/shared/map';
import type { LobbyPlayer, ServerMessage } from '../src/shared/protocol';

const n = Number(process.argv[2] ?? 6);
const mode = process.argv[3] === "dm" ? "dm" : "tag"; // npx tsx scripts/sim-match.ts 6 dm
const roster: LobbyPlayer[] = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `bot${i + 1}`, character: i, ready: true, bot: true }));
// One fake human (id 99) so snapshots/visibility code runs too
roster.push({ id: 99, name: 'watcher', character: 9, ready: true, bot: false });

const counts: Record<string, number> = {};
let snaps = 0;
const log: string[] = [];
let ended = false;

const m = new Match({
  send(_id, msg: ServerMessage) {
    if (msg.type === 'snap') {
      snaps++;
      return;
    }
    if (msg.type === 'ev') {
      for (const e of msg.events) {
        counts[e.k] = (counts[e.k] ?? 0) + 1;
        if (e.k === 'kill') log.push(`  r${m.round} t=${m.timeLeft.toFixed(0)} kill ${e.id} by ${e.by} (${e.cause})`);
        if (e.k === 'det') counts['det_' + e.kind] = (counts['det_' + e.kind] ?? 0) + 1;
      }
      return;
    }
    if (msg.type === 'round_start') benchWatcher();
    if (msg.type === 'round_start') log.push(`round ${msg.round}: taggers ${Object.entries(msg.roles).filter(([, r]) => r === 'tagger').map(([id]) => id)} rang=${msg.rangUnlocked}`);
    if (msg.type === 'round_end') log.push(`  → ${msg.winner}s win${msg.swap ? ' (swap)' : ''}`);
    if (msg.type === 'match_end') {
      ended = true;
      log.push('match end: ' + msg.standings.map(s => `${s.name}:${s.score}`).join(' '));
    }
  },
  onMatchEnd() {},
}, roster, mode, process.argv[4] === "full" ? undefined : roofsForPlayers(roster.length)); // 3rd arg "full" = whole city

// The watcher is a connected "human" that sits out every round as a dead spectator
const internals = m as unknown as { step(): void; startRound(first: boolean): void };
const benchWatcher = () => { const w = m.players.find(p => p.id === 99)!; w.alive = false; };
internals.startRound(true);
benchWatcher();
const t0 = Date.now();
let ticks = 0;
while (!ended && ticks < 60 * 60 * 25) {
  internals.step();
  ticks++;
}
console.log(log.join('\n'));
console.log(`ticks ${ticks} (${(ticks / 60 / 60).toFixed(1)} game-min) in ${Date.now() - t0}ms`);
console.log('events', counts);
console.log(`snapshots ${snaps}`);
