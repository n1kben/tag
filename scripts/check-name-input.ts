// Typing a lobby name must survive lobby re-renders: same <input>, caret where the user left it.
// Usage: npx tsx scripts/check-name-input.ts <baseUrl>
import { chromium, type Page } from 'playwright-core';

const [site] = process.argv.slice(2);
const base = `${site}/?lite`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}
async function waitVisible(page: Page, sel: string, ms = 15000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${sel}`);
}

const a = await (await browser.newContext()).newPage();
await a.goto(base, { waitUntil: 'load' });
await a.getByText('CREATE ROOM').click();
await waitVisible(a, '.name-in');
const code = (await a.textContent('.room-code'))!.trim();
const b = await (await browser.newContext()).newPage();
await b.goto(`${base}#${code}`, { waitUntil: 'load' });
await waitVisible(b, '.room-code');

// A edits their name: clear it, type a slow prefix (pauses past any debounce), then move the caret to the start
await a.evaluate(`(window.__nameIn = document.querySelector('.name-in'), 0)`);
await a.click('.name-in');
await a.keyboard.press('ControlOrMeta+A');
await a.keyboard.press('Backspace');
for (const ch of 'Bob') { await a.keyboard.type(ch); await a.waitForTimeout(600); }
await a.evaluate(`document.querySelector('.name-in').setSelectionRange(0, 0)`);
// Meanwhile B changes the lobby, which re-renders it for A
await b.getByText('+ BOT').click();
await a.waitForTimeout(500);
await a.keyboard.type('X');
await a.waitForTimeout(300);

const r = await a.evaluate(`(() => {
  const el = document.querySelector('.name-in');
  return { same: el === window.__nameIn, focused: document.activeElement === el, value: el.value, caret: el.selectionStart };
})()`) as { same: boolean; focused: boolean; value: string; caret: number };
check(r.same, 'name input element survives re-renders');
check(r.focused, 'name input keeps focus');
check(r.value === 'XBob', `typed text lands at the caret (got "${r.value}", want "XBob")`);
check(r.caret === 1, `caret stays after the typed char (got ${r.caret})`);

await a.keyboard.press('Enter');
await a.waitForTimeout(500);
check((await b.locator('.card .nm', { hasText: 'XBob' }).count()) === 1, 'B sees the new name after Enter');

await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
