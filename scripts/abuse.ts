// Sends hostile/malformed messages to a running server and checks it survives.
// Usage: npx tsx scripts/abuse.ts ws://127.0.0.1:3001
import { WebSocket } from 'ws';

const url = process.argv[2] ?? 'ws://127.0.0.1:3001';
const open = () => new Promise<WebSocket>((res, rej) => { const ws = new WebSocket(url); ws.on('open', () => res(ws)); ws.on('error', rej); });
const next = (ws: WebSocket, type: string) => new Promise<Record<string, unknown>>(res => {
  const on = (d: Buffer) => { const m = JSON.parse(String(d)); if (m.type === type) { ws.off('message', on); res(m); } };
  ws.on('message', on);
});

// An oversized frame should get only that socket terminated
const big = await open();
big.on('error', () => {});
big.send('x'.repeat(10000));
await new Promise(r => setTimeout(r, 200));

const ws = await open();
for (const bad of ['null', '42', '"x"', '[]', '{}', '{"type":5}', '{"type":"input","seq":"a","mx":"b","b":"c"}', '{"type":"join_room"}']) ws.send(bad);
const welcome = next(ws, 'welcome');
ws.send(JSON.stringify({ type: 'create_room' }));
await welcome;
const lobby = next(ws, 'lobby');
ws.send(JSON.stringify({ type: 'profile', character: 1.5, name: { evil: true } }));
ws.send(JSON.stringify({ type: 'profile', character: 3 }));
const l = await lobby as { players: { character: number }[] };
await new Promise(r => setTimeout(r, 200));
const probe = await open();
const pong = next(probe, 'pong');
probe.send(JSON.stringify({ type: 'ping', t: 1 }));
await pong;
const chars = l.players.map(p => p.character);
console.log(`server alive after abuse: yes; characters stay integers: ${chars.every(Number.isInteger)} (${chars})`);
ws.close(); probe.close();
