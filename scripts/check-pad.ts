// Gamepad menus with a fake 8BitDo: a press shows the focus ring and pad hints (Nintendo labels),
// the d-pad moves between buttons, A presses, B leaves the lobby, Start readies up, Select holds
// the scoreboard, and a key press brings the keyboard hints back. Then two pads: each window follows the
// input picked on CONTROLS (one pad, or the keyboard only), kept per window and across a reconnect, and
// pickable from the lobby too, for a window that joined by link.
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

/** Wait out a few rendered frames: swiftshader stalls for hundreds of ms now and then, so a timed tap can miss every frame. */
const frames = (pg: Page, n = 3) => pg.evaluate(`new Promise(r => { let n = ${n}; const f = () => --n ? requestAnimationFrame(f) : r(); requestAnimationFrame(f); })`);
/** Tap a button for a few frames. */
const press = async (pg: Page, i: number, ms = 120) => {
  await pg.evaluate(`window.__pad.buttons[${i}].pressed = true`);
  await pg.waitForTimeout(ms); await frames(pg);
  await pg.evaluate(`window.__pad.buttons[${i}].pressed = false`);
  await pg.waitForTimeout(150); await frames(pg);
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

// CONTROLS: rebind jump to RB, which leaves frost; RESET brings the defaults back
await p.evaluate(`document.querySelector('[data-a=controls]').focus()`);
await press(p, 0);
check(await shown('.screen.on [data-a=bind-jump]'), 'A on CONTROLS opens the controls screen');
await p.evaluate(`document.querySelector('[data-a=bind-jump]').focus()`);
await press(p, 0); // pick Jump
check(await p.evaluate(`document.querySelector('[data-a=bind-jump]').textContent.includes('PRESS')`) as boolean, 'picking Jump waits for a button');
await press(p, 5); // RB
const bindText = (a: string) => p.evaluate(`document.querySelector('[data-a=bind-${a}]').textContent`) as Promise<string>;
check((await bindText('jump')).includes('RB'), `Jump is now RB (${await bindText('jump')})`);
check(!(await bindText('frost')).includes('RB'), `RB left frost (${await bindText('frost')})`);
check(await p.evaluate(`JSON.parse(localStorage.getItem('padBinds')).jump[0] === 5`) as boolean, 'binding saved');
check(await focused() === 'bind-jump', `focus stays on the Jump row (${await focused()})`);
if (out) await p.screenshot({ path: `${out}/pad-controls.png` });
await p.evaluate(`document.querySelector('[data-a=reset]').click()`);
check((await bindText('jump')).includes('A') && (await bindText('frost')).includes('RB'), 'RESET restores the defaults');
await press(p, 1); // B: back
check(await shown('.screen.sky.on [data-a=practice]'), 'B goes back to the title');
await p.evaluate(`document.querySelector('[data-a=create]').focus()`);

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

// Two pads, two windows: one follows pad 2 only, one the keyboard only
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx2.addInitScript(() => {
  const pads = ['8BitDo Pro 2 (STANDARD GAMEPAD Vendor: 2dc8)', 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)'].map((id, index) => ({
    id, index, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }));
  (window as unknown as { __pads: typeof pads }).__pads = pads;
  navigator.getGamepads = () => pads as unknown as Gamepad[];
});
const w1 = await ctx2.newPage(), w2 = await ctx2.newPage();
for (const w of [w1, w2]) { w.on('pageerror', e => console.log('PAGEERROR', e.message)); await w.goto(`${base}/?lite`); }
await w1.waitForTimeout(800);
// Focus checks below only ask "did it move": a stall mid-hold can auto-repeat a direction
const tap = async (pg: Page, pad: number, i: number) => {
  await pg.evaluate(`window.__pads[${pad}].buttons[${i}].pressed = true`);
  await pg.waitForTimeout(120); await frames(pg);
  await pg.evaluate(`window.__pads[${pad}].buttons[${i}].pressed = false`);
  await pg.waitForTimeout(150); await frames(pg);
};
const focusIn = (pg: Page) => pg.evaluate(`document.activeElement?.dataset?.a ?? document.activeElement?.tagName`) as Promise<string>;
const source = (pg: Page) => pg.evaluate(`sessionStorage.getItem('inputSource')`) as Promise<string | null>;
const isPad = (pg: Page) => pg.evaluate(`document.documentElement.classList.contains('pad')`) as Promise<boolean>;

await w1.bringToFront();
await w1.click('[data-a=controls]');
check(await w1.evaluate(`!!document.querySelector('[data-a=src-pad0]') && !!document.querySelector('[data-a=src-pad1]')`) as boolean, 'CONTROLS lists both pads');
await w1.click('[data-a=pick]');
await tap(w1, 1, 0); // A on the Xbox pad picks it
check(JSON.parse(await source(w1) ?? 'null')?.index === 1, `pressing on pad 2 picks it (${await source(w1)})`);
check(await w1.evaluate(`document.querySelector('[data-a=src-pad1]').classList.contains('on')`) as boolean, 'PAD 2 shows as chosen');
if (out) await w1.screenshot({ path: `${out}/pad-source.png` });
await w1.click('[data-a=back]'); // the click drops pad mode, so the next press only wakes it
check(!(await isPad(w1)), 'window 1 back in keyboard hints');
await tap(w1, 0, 13);
check(!(await isPad(w1)), 'window 1 ignores pad 1');
await tap(w1, 1, 13);
check(await isPad(w1) && await focusIn(w1) === 'practice', `window 1 wakes on pad 2 (${await focusIn(w1)})`);
await tap(w1, 0, 13);
check(await focusIn(w1) === 'practice', `pad 1 doesn't move window 1's focus (${await focusIn(w1)})`);
await tap(w1, 1, 13);
check(await focusIn(w1) !== 'practice', `pad 2 does (${await focusIn(w1)})`);

await w2.bringToFront();
check(await source(w2) === null, 'window 2 has its own choice (default ANY)');
await w2.click('[data-a=controls]');
await w2.click('[data-a=src-keys]');
check(await source(w2) === '"keys"', 'window 2 picks KEYBOARD');
await w2.click('[data-a=back]');
await tap(w2, 0, 13); await tap(w2, 1, 13); await tap(w2, 1, 0);
check(!(await isPad(w2)) && await w2.evaluate(`document.querySelector('.screen.sky.on')`) !== null, 'keyboard window ignores both pads');

// Reconnect with the indexes swapped: window 1 follows the Xbox pad to index 0
await w1.evaluate(`(() => { const [a, b] = window.__pads; a.index = 1; b.index = 0; window.__pads.reverse(); })()`);
const before = await focusIn(w1);
await tap(w1, 1, 12); // the 8BitDo, now index 1
check(await focusIn(w1) === before, `after the swap pad 1 still ignored (${await focusIn(w1)})`);
await tap(w1, 0, 12); // the Xbox, now index 0
check(await focusIn(w1) !== before, `after the swap the Xbox pad still drives window 1 (${await focusIn(w1)})`);
check(JSON.parse(await source(w1) ?? 'null')?.index === 0, `stored index follows it (${await source(w1)})`);

// From the lobby: window 1 makes a room, window 2 joins by link (never sees the title). Each card shows
// its window's input, CONTROLS opens from the lobby, and BACK redraws a lobby that changed meanwhile.
const cards = (pg: Page) => pg.evaluate(`document.querySelectorAll('.lobby.on .card').length`) as Promise<number>;
const srcLabel = (pg: Page) => pg.evaluate(`document.querySelector('.lobby.on .card.me [data-a=input]')?.textContent ?? ''`) as Promise<string>;
await w1.bringToFront();
await w1.click('[data-a=create]');
await w1.waitForSelector('.lobby.on .room-code');
check((await srcLabel(w1)).includes('PAD 1 · Xbox Wireless Controller'), `window 1's card shows its pad (${await srcLabel(w1)})`);
const room = (await w1.textContent('.lobby.on .room-code'))!.trim();
await w1.click('.lobby.on [data-a=controls]');
check(await w1.evaluate(`!!document.querySelector('.screen.on [data-a=src-any]')`) as boolean, 'CONTROLS opens from the lobby');
await w2.goto('about:blank'); // a bare hash change wouldn't reload
await w2.goto(`${base}/?lite#${room}`);
await w2.waitForSelector('.lobby.on .card.me');
check((await srcLabel(w2)).includes('KEYBOARD'), `window 2 kept KEYBOARD across the reload (${await srcLabel(w2)})`);
await w2.click('.lobby.on .card.me [data-a=input]');
await w2.click('[data-a=pick]');
await tap(w2, 0, 0); // the 8BitDo (the reload put the fake pads back in order)
await w2.click('[data-a=back]');
await w2.waitForSelector('.lobby.on');
check((await srcLabel(w2)).includes('PAD 1 · 8BitDo'), `window 2 picked its pad from the lobby (${await srcLabel(w2)})`);
await w1.bringToFront();
await w1.click('[data-a=src-keys]');
await w1.click('[data-a=back]');
await w1.waitForSelector('.lobby.on');
check(await cards(w1) === 2, `window 1's lobby caught up with the join (${await cards(w1)} cards)`);
check((await srcLabel(w1)).includes('KEYBOARD'), `window 1's card shows KEYBOARD (${await srcLabel(w1)})`);
if (out) await w1.screenshot({ path: `${out}/pad-lobby.png` });

await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
