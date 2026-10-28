// Deathmatch end-to-end with two real browsers: pick the mode in the lobby, play, die, respawn.
// Usage: npx tsx scripts/dm-e2e.ts <baseUrl> <outDir>
import { chromium, type Page } from 'playwright-core';

const [base, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

async function waitVisible(page: Page, sel: string, ms = 15000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function client(name: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on('pageerror', e => { console.log(`[${name} pageerror]`, e.message); failures++; });
  return page;
}

// Title screen mode switch
const t = await client('T');
await t.goto(base);
await waitVisible(t, '[data-m=dm]');
await t.click('[data-m=dm]');
check(await t.locator('[data-m=dm].on').count() === 1, 'title: Deathmatch can be selected');
await t.screenshot({ path: `${outDir}/dm-title.png` });
await t.close();

const a = await client('A');
const spawnsForA: number[] = [];
let myIdA = -1;
a.on('websocket', ws => ws.on('framereceived', f => {
  const s = String(f.payload);
  if (s.startsWith('{"type":"welcome"')) myIdA = JSON.parse(s).playerId;
  if (s.startsWith('{"type":"ev"')) for (const e of JSON.parse(s).events) if (e.k === 'spawn' && e.id === myIdA) spawnsForA.push(Date.now());
}));
await a.goto(base);
await a.getByText('CREATE ROOM').click();
check(await waitVisible(a, '.room-code'), 'room created');
const code = (await a.textContent('.room-code'))!.trim();
await a.click('.lobby [data-m=dm]');

const b = await client('B');
await b.goto(`${base}/#${code}`);
check(await waitVisible(b, '.room-code'), 'B joined');
await new Promise(r => setTimeout(r, 600));
check(await b.locator('.lobby [data-m=dm].on').count() === 1, 'B sees the room switched to Deathmatch');
await a.getByText('+ BOT').click();
await new Promise(r => setTimeout(r, 200));
await a.getByText('+ BOT').click();
await new Promise(r => setTimeout(r, 400));
await a.screenshot({ path: `${outDir}/dm-lobby.png` });
await a.locator('[data-a=ready]').click();
await new Promise(r => setTimeout(r, 300));
await b.locator('[data-a=ready]').click();

check(await waitVisible(a, '.role-chip') && await waitVisible(b, '.role-chip'), 'match started on both');
check((await a.textContent('.role-chip'))?.trim() === 'DEATHMATCH', 'HUD says DEATHMATCH (no hide phase)');
check(await waitVisible(a, '.mini', 3000), 'live leaderboard shown');
check(/^\d:\d\d$/.test((await a.textContent('.timer'))?.trim() ?? ''), 'match clock running straight away');
await new Promise(r => setTimeout(r, 1500));
await a.screenshot({ path: `${outDir}/dm-play.png` });

// A stands still; the bots will come for them. Wait for death → countdown → respawn.
const died = await waitVisible(a, '.respawn', 90000);
check(died, 'A was killed and sees the respawn countdown');
if (died) {
  await a.screenshot({ path: `${outDir}/dm-dead.png` });
  const end = Date.now() + 8000;
  while (Date.now() < end && spawnsForA.length === 0) await new Promise(r => setTimeout(r, 200));
  check(spawnsForA.length > 0, 'A respawned');
  await new Promise(r => setTimeout(r, 500));
  check(!(await a.locator('.respawn').isVisible().catch(() => false)), 'countdown gone after respawn');
  await a.screenshot({ path: `${outDir}/dm-respawned.png` });
}
const board = await a.locator('.mini div').allTextContents();
console.log('leaderboard:', board.join(' | '));
check(board.length >= 2, 'leaderboard lists players');

await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
