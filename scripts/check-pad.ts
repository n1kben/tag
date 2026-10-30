// Gamepad menus with a fake 8BitDo: a press shows the focus ring and pad hints (Nintendo labels),
// the d-pad moves between buttons, A presses, B leaves the lobby, Start readies up, Select holds
// the scoreboard, and a key press brings the keyboard hints back.
// Usage: npx tsx scripts/check-pad.ts <baseUrl> [outDir]
import { chromium, type Page } from 'playwright-core';

const [base, out] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  const pad = { id: '8BitDo Pro 2 (STANDARD GAMEPAD Vendor: 2dc8)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  (window as unknown as { __pad: typeof pad }).__pad = pad;
  navigator.getGamepads = () => [pad as unknown as Gamepad];
});
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${base}/?lite`);
await p.waitForTimeout(800);

/** Tap a button for a few frames. */
const press = async (pg: Page, i: number, ms = 120) => {
  await pg.evaluate(`window.__pad.buttons[${i}].pressed = true`);
  await pg.waitForTimeout(ms);
  await pg.evaluate(`window.__pad.buttons[${i}].pressed = false`);
  await pg.waitForTimeout(150);
};
const focused = () => p.evaluate(`(() => { const e = document.activeElement; return e?.dataset?.a ?? e?.dataset?.m ?? e?.tagName; })()`) as Promise<string>;
const shown = (sel: string) => p.evaluate(`(() => { const e = document.querySelector('${sel}'); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; })()`) as Promise<boolean>;

await press(p, 13); // first press only wakes the pad
check(await p.evaluate(`document.documentElement.classList.contains('pad')`) as boolean, 'pad press switches to pad mode');
check(await p.evaluate(`document.documentElement.classList.contains('nin')`) as boolean, '8BitDo gets Nintendo labels');
check(await focused() === 'practice', `focus starts on PLAY VS BOTS (${await focused()})`);
check(await shown('.hint .padh') && !(await shown('.hint .kbh')), 'title shows pad hints');
await press(p, 13);
check(await focused() === 'create', `down → CREATE ROOM (${await focused()})`);
await press(p, 12); await press(p, 12);
check(await focused() === 'tag' || await focused() === 'dm', `up twice → mode toggle (${await focused()})`);
await press(p, 14);
check(await focused() === 'tag', `left → TAG (${await focused()})`);
await press(p, 15);
check(await focused() === 'dm', `right → DEATHMATCH (${await focused()})`);
await press(p, 13); await press(p, 13);
check(await focused() === 'create', `down twice → CREATE ROOM (${await focused()})`);
if (out) await p.screenshot({ path: `${out}/pad-title.png` });

await press(p, 0); // A: create a room
for (let i = 0; i < 20 && !(await shown('.lobby.on')); i++) await p.waitForTimeout(250);
await p.waitForTimeout(300);
check(await shown('.lobby.on'), 'A on CREATE ROOM opens the lobby');
check(await p.evaluate(`document.activeElement?.tagName === 'BUTTON'`) as boolean, `a lobby button has focus (${await focused()})`);
const img0 = await p.evaluate(`document.querySelector('.card.me img').src`);
await press(p, 5); // RB: next character
await p.waitForTimeout(400);
check(await p.evaluate(`document.querySelector('.card.me img').src`) !== img0, 'RB changes character');
await press(p, 1); // B: leave
for (let i = 0; i < 20 && !(await shown('.screen.sky.on')); i++) await p.waitForTimeout(250);
check(await shown('.screen.sky.on'), 'B leaves to the title');

// Practice: Start a match from the pad, hold Select for the board
await p.waitForTimeout(300);
await press(p, 0); // A on the remembered/default button
await p.waitForTimeout(400);
if (!(await shown('.hud.on'))) { // landed on a lobby: ready up with Start
  await press(p, 9);
}
for (let i = 0; i < 20 && !(await shown('.hud.on')); i++) await p.waitForTimeout(250);
check(await shown('.hud.on'), 'a match starts from the pad');
await p.waitForTimeout(500);
check(await shown('.hud .keys .padh') && !(await shown('.hud .keys .kbh')), 'HUD shows pad hints');
check(await p.evaluate(`[...document.querySelectorAll('.hud .keys .nn')].some(e => getComputedStyle(e).display !== 'none')`) as boolean, 'HUD uses Nintendo labels');
await p.evaluate(`window.__pad.buttons[8].pressed = true`);
await p.waitForTimeout(150);
check(await shown('.board'), 'holding Select shows the scoreboard');
if (out) await p.screenshot({ path: `${out}/pad-hud.png` });
await p.evaluate(`window.__pad.buttons[8].pressed = false`);
await p.waitForTimeout(150);
check(!(await shown('.board')), 'letting go hides it');
await p.keyboard.press('KeyW');
await p.waitForTimeout(300);
check(await shown('.hud .keys .kbh') && !(await shown('.hud .keys .padh')), 'a key press brings keyboard hints back');

await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
