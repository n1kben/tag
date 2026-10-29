// Two real browser clients: create room, join by invite link, add bots, ready up, play.
// Usage: npx tsx scripts/mp-e2e.ts <baseUrl> <outDir>
import { chromium, type Page } from 'playwright-core';

const [site, outDir] = process.argv.slice(2);
const base = `${site}/?lite`; // half-res, no shadows: keeps two software-GL tabs responsive
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failures = 0;
async function waitFor(fn: () => Promise<boolean>, ms = 15000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 250)); }
  return false;
}

/** Poll instead of waitForSelector: rAF-based polling starves while SwiftShader renders WebGL. */
async function waitVisible(page: Page, sel: string, ms = 15000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${sel}`);
}

function check(ok: boolean, what: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

async function client(name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log(`[${name} pageerror]`, e.message); failures++; });
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) console.log(`[${name}]`, m.text()); });
  return page;
}

const a = await client('A');
await a.goto(base, { waitUntil: 'load' });
await a.getByText('CREATE ROOM').click();
await waitVisible(a, '.room-code');
const code = (await a.textContent('.room-code'))!.trim();
check(/^[A-Z0-9]{5}$/.test(code), `room created with code ${code}`);
check(a.url().endsWith(`#${code}`), 'invite link is in the URL hash');

const b = await client('B');
await b.goto(`${base}#${code}`, { waitUntil: 'load' });
await waitVisible(b, '.room-code');
await a.waitForTimeout(500);
check((await a.locator('.card').count()) === 2, 'A sees two players after B joins');

await a.getByText('+ BOT').click();
await a.waitForTimeout(200);
await a.getByText('+ BOT').click();
await a.waitForTimeout(400);
check((await b.locator('.card').count()) === 4, 'B sees bots added by A');

// Rename + character switch propagate
await b.locator('.name-in').fill('Tester B');
await b.locator('[data-a=next]').click();
await a.waitForTimeout(900);
check((await a.locator('.card .nm', { hasText: 'Tester B' }).count()) === 1, 'rename propagates to other client');
await a.screenshot({ path: `${outDir}/mp-lobby.png` });

await a.locator('[data-a=ready]').click();
await b.waitForTimeout(300);
check((await b.locator('.card.ready').count()) >= 3, 'ready state propagates (A + bots)');
await b.locator('[data-a=ready]').click();
await waitVisible(a, '.timer');
await waitVisible(b, '.timer');
check(true, 'match started on both clients');

// Move around during the head start + into the chase
await a.keyboard.down('KeyS');
await b.keyboard.down('KeyD');
await a.waitForTimeout(1500);
await a.keyboard.up('KeyS');
await b.keyboard.up('KeyD');
const roleA = await a.getAttribute('.hud', 'data-role');
const roleB = await b.getAttribute('.hud', 'data-role');
check(!!roleA && !!roleB, `roles assigned (A=${roleA}, B=${roleB})`);
await a.screenshot({ path: `${outDir}/mp-a-start.png` });
await b.screenshot({ path: `${outDir}/mp-b-start.png` });
// Bots can tag standing humans fast and start the next round's head start, so poll for the clock
let timerA = '';
const chased = await waitFor(async () => /^\d:\d\d$/.test(timerA = (await a.textContent('.timer'))?.trim() ?? ''), 12000);
check(chased, `chase phase reached (timer "${timerA}")`);
await a.keyboard.down('Enter');
await a.waitForTimeout(80);
await a.keyboard.up('Enter');
await a.waitForTimeout(400);
await a.screenshot({ path: `${outDir}/mp-a-chase.png` });
await b.screenshot({ path: `${outDir}/mp-b-chase.png` });

// Leaving returns to title and the other client keeps playing
await b.keyboard.press('Escape');
await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
