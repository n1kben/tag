// Hide 'n Seek balance vs map size: bots-only matches at several roofs-per-player ratios.
// Prints the hider round-win rate (aim: near 50%) and how often players fall off.
// Run: npx tsx scripts/balance.ts [matches=3]
import { Match } from '../src/server/match';
import { roofsForPlayers } from '../src/shared/map';
import type { LobbyPlayer } from '../src/shared/protocol';

const runs = Number(process.argv[2] ?? 3);

function play(players: number, ratio: number): { hiderWins: number; rounds: number; falls: number; kills: number } {
  const roster: LobbyPlayer[] = Array.from({ length: players }, (_, i) => ({ id: i + 1, name: `b${i}`, character: i % 10, ready: true, bot: true }));
  roster.push({ id: 99, name: 'w', character: 9, ready: true, bot: false }); // keeps the match alive; benched
  let hiderWins = 0, rounds = 0, falls = 0, kills = 0, ended = false;
  const m: Match = new Match({
    send(_id, msg) {
      if (msg.type === 'round_start') { const w = m.players.find(p => p.id === 99); if (w) w.alive = false; }
      if (msg.type === 'round_end') { rounds++; if (msg.winner === 'hider') hiderWins++; }
      if (msg.type === 'ev') for (const e of msg.events) if (e.k === 'kill') { kills++; if (e.cause === 'void' || e.cause === 'fall') falls++; }
      if (msg.type === 'match_end') ended = true;
    },
    onMatchEnd() {},
  }, roster, 'hns', roofsForPlayers(players, ratio));
  const I = m as unknown as { step(): void; startRound(first: boolean): void };
  I.startRound(true);
  m.players.find(p => p.id === 99)!.alive = false;
  for (let t = 0; t < 60 * 60 * 25 && !ended; t++) I.step();
  return { hiderWins, rounds, falls, kills };
}

for (const players of [4, 6, 10]) {
  for (const ratio of [1.25, 99]) { // 99 = whole city (baseline)
    const tot = { hiderWins: 0, rounds: 0, falls: 0, kills: 0 };
    for (let i = 0; i < runs; i++) {
      const r = play(players, ratio);
      for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += r[k];
    }
    const roofs = roofsForPlayers(players, ratio).length;
    console.log(`${players} players, ${ratio} roof/player → ${roofs} roofs: hiders won ${tot.hiderWins}/${tot.rounds} `
      + `(${Math.round((100 * tot.hiderWins) / Math.max(1, tot.rounds))}%), falls ${Math.round((100 * tot.falls) / Math.max(1, tot.kills))}% of deaths`);
  }
}
