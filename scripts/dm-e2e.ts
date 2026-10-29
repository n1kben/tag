// Team Deathmatch end-to-end with two real browsers: pick the mode in the lobby, play,
// get caught as a runner, come back as a tagger. Usage: npx tsx scripts/dm-e2e.ts <baseUrl> <outDir>
import { chromium, type Page } from 'playwright-core';

const [site, outDir] = process.argv.slice(2);
const base = `${site}/?lite`; // half-res, no shadows: keeps two software-GL tabs responsive
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

async function waitFor(fn: () => Promise<boolean>, ms = 15000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}
const visible = (page: Page, sel: string) => () => page.locator(sel).first().isVisible();
const chip = async (page: Page) => (await page.textContent('.role-chip').catch(() => ''))?.trim() ?? '';

async function client(name: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on('pageerror', e => { console.log(`[${name} pageerror]`, e.message); failures++; });
  return page;
}

// Title screen mode switch
const t = await client('T');
await t.goto(base);
await waitFor(visible(t, '[data-m=dm]'));
await t.click('[data-m=dm]');
check(await t.locator('[data-m=dm].on').count() === 1, 'title: Deathmatch can be selected');
await t.screenshot({ path: `${outDir}/dm-title.png` });
await t.close();

const a = await client('A');
const ids = new Map<Page, number>();
const caughtIds = new Set<number>();
const runnerId = (p: Page) => ids.get(p) ?? -1;
function watch(page: Page): void {
  page.on('websocket', ws => ws.on('framereceived', f => {
    const s = String(f.payload);
    if (s.startsWith('{"type":"welcome"')) ids.set(page, JSON.parse(s).playerId);
    if (s.startsWith('{"type":"ev"')) for (const e of JSON.parse(s).events) if (e.k === 'kill' && e.by !== null) caughtIds.add(e.id);
  }));
}
watch(a);
await a.goto(base);
await a.getByText('CREATE ROOM').click();
check(await waitFor(visible(a, '.room-code')), 'room created');
const code = (await a.textContent('.room-code'))!.trim();
await a.click('.lobby [data-m=dm]');

const b = await client('B');
watch(b);
await b.goto(`${base}#${code}`);
check(await waitFor(visible(b, '.room-code')), 'B joined');
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

check(await waitFor(visible(a, '.role-chip')) && await waitFor(visible(b, '.role-chip')), 'match started on both');
const roleA = await chip(a), roleB = await chip(b);
check(/^(RUNNER|TAGGER) · DM$/.test(roleA) && /^(RUNNER|TAGGER) · DM$/.test(roleB), `teams in deathmatch (A=${roleA}, B=${roleB})`);
check(((await a.textContent('.timer')) ?? '').startsWith('RUN'), 'runners get the head start');
check(await waitFor(visible(a, '.teams'), 3000) && await a.locator('.mini').count() === 0, 'team pips shown, no always-on leaderboard');
await a.screenshot({ path: `${outDir}/dm-start.png` });
check(await waitFor(async () => /^\d:\d\d$/.test(((await a.textContent('.timer')) ?? '').trim()), 15000), 'deathmatch clock starts after the head start');
await a.screenshot({ path: `${outDir}/dm-play.png` });

// A human runner stands still; the tagger bots catch them → they come back as a tagger.
const runner = roleA.startsWith('RUNNER') ? a : roleB.startsWith('RUNNER') ? b : null;
if (!runner) {
  console.log('SKIP catch/swap check: both humans started as taggers this time');
} else {
  // The catch can land within a second of the chase, so watch for the outcome, not the 2s overlay
  const swapped = await waitFor(async () => (await chip(runner)) === 'TAGGER · DM', 90000);
  check(swapped && caughtIds.has(runnerId(runner)), 'human runner got caught (kill event) and is back in as a TAGGER');
  await runner.screenshot({ path: `${outDir}/dm-swapped.png` });
}
await a.keyboard.down('Tab');
await waitFor(visible(a, '.board'), 2000);
const board = (await a.locator('.board tr').allTextContents()).slice(1);
await a.keyboard.up('Tab');
console.log('leaderboard:', board.join(' | '));
check(board.length >= 2, 'holding Tab shows the scoreboard');

await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
