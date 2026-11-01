// Gamepad menus with a fake 8BitDo: a press shows the focus ring and pad hints (Nintendo labels),
// the d-pad moves between buttons, A presses, B leaves the lobby, Start readies up, CONTROLS (in the
// lobby) rebinds this pad model and the keyboard, Select holds the scoreboard, a key press brings the
// keyboard hints back, and Start / Esc open the in-match menu. Then split screen: two pads and the
// keyboard join one lobby as three players, and each moves only its own player.
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

check(!(await shown('.screen.sky.on [data-a=controls]')), 'the title has no CONTROLS');
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

// CONTROLS from the lobby, on this pad: rebind jump to RB, which leaves frost; RESET brings the defaults back
const PAD_ID = '8BitDo Pro 2 (STANDARD GAMEPAD Vendor: 2dc8)';
await p.evaluate(`document.querySelector('[data-a=controls]').focus()`);
await press(p, 0);
check(await shown('.screen.on [data-a=bind-jump]'), 'A on CONTROLS opens the controls screen');
check(await p.evaluate(`document.querySelector('[data-a=dev-0]').classList.contains('on')`) as boolean, 'it opens on the pad in use');
await p.evaluate(`document.querySelector('[data-a=bind-jump]').focus()`);
await press(p, 0); // pick Jump
check(await p.evaluate(`document.querySelector('[data-a=bind-jump]').textContent.includes('PRESS')`) as boolean, 'picking Jump waits for a button');
await press(p, 5); // RB
const bindText = (a: string) => p.evaluate(`document.querySelector('[data-a=bind-${a}]').textContent`) as Promise<string>;
check((await bindText('jump')).includes('RB'), `Jump is now RB (${await bindText('jump')})`);
check(!(await bindText('frost')).includes('RB'), `RB left frost (${await bindText('frost')})`);
check(await p.evaluate(`JSON.parse(localStorage.getItem('binds')).pads[${JSON.stringify(PAD_ID)}].jump[0] === 5`) as boolean, 'binding saved for this pad model');
check(await focused() === 'bind-jump', `focus stays on the Jump row (${await focused()})`);
if (out) await p.screenshot({ path: `${out}/pad-controls.png` });
await p.evaluate(`document.querySelector('[data-a=reset]').click()`);
check((await bindText('jump')).includes('A') && (await bindText('frost')).includes('RB'), 'RESET restores the defaults');
// …and the keyboard: jump on L
await p.click('[data-a=dev-keys]');
await p.click('[data-a=bind-jump]');
check((await bindText('jump')).includes('PRESS A KEY'), 'keyboard Jump waits for a key');
await p.keyboard.press('KeyW'); // moving keys stay fixed: still waiting
await p.keyboard.press('KeyL');
check((await bindText('jump')).trim() === 'L', `keyboard Jump is now L (${await bindText('jump')})`);
check(await p.evaluate(`JSON.parse(localStorage.getItem('binds')).keys.jump[0] === 'KeyL'`) as boolean, 'key binding saved');
await press(p, 13); // the clicks put the menus on keyboard hints: wake the pad
await press(p, 1); // B: back
check(await shown('.lobby.on'), 'B goes back to the lobby');
await press(p, 1); // B: leave
for (let i = 0; i < 20 && !(await shown('.screen.sky.on')); i++) await p.waitForTimeout(250);
check(await shown('.screen.sky.on'), 'B leaves to the title');

// PLAY VS BOTS: a lobby with bots in it; Start readies and the match starts. Hold Select for the board
await p.waitForTimeout(300);
await p.evaluate(`document.querySelector('[data-a=practice]').focus()`);
await press(p, 0);
for (let i = 0; i < 20 && !(await shown('.lobby.on .card')); i++) await p.waitForTimeout(250);
await p.waitForTimeout(300);
check(await p.evaluate(`document.querySelectorAll('.lobby.on .card').length`) === 6, `PLAY VS BOTS opens a lobby with 5 bots (${await p.evaluate(`document.querySelectorAll('.lobby.on .card').length`)} cards)`);
await press(p, 9);
for (let i = 0; i < 20 && !(await shown('.hud.on')); i++) await p.waitForTimeout(250);
check(await shown('.hud.on'), 'a match starts from the pad');
await p.waitForTimeout(500);
check(await shown('.hud .keys .padh') && !(await shown('.hud .keys .kbh')), 'HUD shows pad hints');
check(await p.evaluate(`[...document.querySelectorAll('.hud .keys .nn')].some(e => getComputedStyle(e).display !== 'none')`) as boolean, 'HUD uses Nintendo labels');
await p.evaluate(`window.__pad.buttons[8].pressed = true`);
await p.waitForTimeout(150); await frames(p);
check(await shown('.board'), 'holding Select shows the scoreboard');
if (out) await p.screenshot({ path: `${out}/pad-hud.png` });
await p.evaluate(`window.__pad.buttons[8].pressed = false`);
await p.waitForTimeout(150); await frames(p);
check(!(await shown('.board')), 'letting go hides it');
await p.keyboard.press('KeyW');
await p.waitForTimeout(300);
check(await shown('.hud .keys .kbh') && !(await shown('.hud .keys .padh')), 'a key press brings keyboard hints back');
const kbHint = await p.evaluate(`document.querySelector('.hud .keys .kbh').textContent`) as string;
check(/L jump/.test(kbHint), `keyboard hints follow the binding (${kbHint})`);

// The menu: Start opens it, B resumes; Esc opens and closes it; LEAVE MATCH asks, then leaves
await press(p, 9);
check(await shown('.screen.menu.on'), 'Start opens the menu');
if (out) await p.screenshot({ path: `${out}/pad-menu.png` });
await press(p, 1);
check(!(await shown('.screen.menu.on')) && await shown('.hud.on'), 'B resumes');
await p.keyboard.press('Escape'); await frames(p);
check(await shown('.screen.menu.on'), 'Esc opens the menu');
await p.keyboard.press('Escape'); await frames(p);
check(!(await shown('.screen.menu.on')), 'Esc closes it');
await press(p, 9);
await p.evaluate(`document.querySelector('.menu [data-a=quit]').focus()`);
await press(p, 0);
check((await p.textContent('.menu [data-a=quit]'))!.includes('SURE'), 'LEAVE MATCH asks first');
check(await shown('.hud.on'), 'still in the match');
await press(p, 0);
for (let i = 0; i < 20 && !(await shown('.screen.sky.on [data-a=practice]')); i++) await p.waitForTimeout(250);
check(await shown('.screen.sky.on [data-a=practice]'), 'the second press leaves to the title');

// Split screen on one page: P1 on the 8BitDo, P2 joins with the Xbox pad, P3 with the keyboard. Each
// seat moves only with its own device, and the match draws a slice of the screen per seat.
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx2.addInitScript(() => {
  const pads = ['8BitDo Pro 2 (STANDARD GAMEPAD Vendor: 2dc8)', 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)'].map((id, index) => ({
    id, index, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }));
  (window as unknown as { __pads: typeof pads }).__pads = pads;
  navigator.getGamepads = () => pads as unknown as Gamepad[];
});
const w = await ctx2.newPage();
w.on('pageerror', e => console.log('PAGEERROR', e.message));
await w.goto(`${base}/?lite`);
await w.waitForTimeout(800);
const tap = async (pad: number, i: number) => {
  await w.evaluate(`window.__pads[${pad}].buttons[${i}].pressed = true`);
  await w.waitForTimeout(120); await frames(w);
  await w.evaluate(`window.__pads[${pad}].buttons[${i}].pressed = false`);
  await w.waitForTimeout(150); await frames(w);
};
type SeatPos = { id: number; x: number; z: number; alive: boolean };
const seatsNow = () => w.evaluate('window.__net.seats()') as Promise<SeatPos[]>;
const localCards = () => w.evaluate(`[...document.querySelectorAll('.lobby.on .card.me')].map(c => (c.querySelector('.pn')?.textContent ?? '') + ' ' + (c.querySelector('.src')?.textContent ?? ''))`) as Promise<string[]>;

await w.click('[data-a=create]');
await w.waitForSelector('.lobby.on .room-code');
await tap(0, 13); // P1 picks up the 8BitDo
await w.evaluate(`document.querySelector('[data-a=addseat]').focus()`);
await tap(0, 0); // A on + PLAYER
check((await w.textContent('[data-a=addseat]'))!.includes('PRESS'), '+ PLAYER waits for a device');
await tap(0, 0); // P1's own pad again: not a new player
check((await localCards()).length === 1, 'P1 pressing again doesn\'t join');
await tap(1, 0); // the Xbox pad joins
for (let i = 0; i < 20 && (await localCards()).length < 2; i++) await w.waitForTimeout(150);
let cardsNow = await localCards();
check(cardsNow.length === 2 && cardsNow[0].includes('P1') && cardsNow[0].includes('8BitDo') && cardsNow[1].includes('P2') && cardsNow[1].includes('Xbox'), `P2 joins on the Xbox pad (${cardsNow.join(' | ')})`);
const p2img = () => w.evaluate(`document.querySelectorAll('.lobby.on .card.me img')[1]?.src`);
const p2img0 = await p2img();
await tap(1, 5); // P2's RB
await w.waitForTimeout(400);
check(await p2img() !== p2img0, 'P2\'s bumper changes P2\'s character');
await w.click('[data-a=addseat]');
await w.keyboard.press('KeyL'); // the keyboard joins
for (let i = 0; i < 20 && (await localCards()).length < 3; i++) await w.waitForTimeout(150);
cardsNow = await localCards();
check(cardsNow.length === 3 && cardsNow[2].includes('KEYBOARD'), `P3 joins on the keyboard (${cardsNow.join(' | ')})`);
if (out) await w.screenshot({ path: `${out}/split-lobby.png` });

const wShown = (sel: string) => w.evaluate(`(() => { const e = document.querySelector('${sel}'); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; })()`) as Promise<boolean>;
await tap(0, 13); // the mouse clicks put the menus back on keyboard hints: wake P1's pad
await tap(0, 9); // Start on P1: everyone ready
for (let i = 0; i < 30 && !(await wShown('.hud.on')); i++) await w.waitForTimeout(200);
check(await wShown('.hud.on'), 'Start readies all three and the match starts');
await w.waitForTimeout(500);
check(await w.evaluate(`document.querySelectorAll('.hud .seat.split').length`) === 3, 'three split-screen HUDs');
check(await wShown('.board'), 'the spare quarter shows the board');
for (let i = 0; i < 40 && (await w.evaluate('window.__net.server().phase')) !== 'chase'; i++) await w.waitForTimeout(250);
await w.waitForTimeout(300);

/** Hold a device for a while and see which seats moved. */
const moved = async (hold: () => Promise<void>, release: () => Promise<void>) => {
  const a = await seatsNow();
  await hold(); await w.waitForTimeout(700); await release(); await w.waitForTimeout(300);
  const b = await seatsNow();
  const r = a.map((s, i) => s.alive && b[i].alive && Math.hypot(b[i].x - s.x, b[i].z - s.z) > 1);
  return Object.assign(r, { dead: a.map((s, i) => !s.alive || !b[i].alive), toString: () => r.join() + ' · ' + a.map((s, i) => `${s.alive ? '' : 'dead '}${Math.hypot(b[i].x - s.x, b[i].z - s.z).toFixed(1)}m`).join(' ') });
};
/** Seat n moved and no other did; a seat that died meanwhile (fell off, got tagged) can't tell us, so skip. */
const only = (m: boolean[] & { dead?: boolean[] }, n: number, what: string) => {
  if (m.dead?.[n]) { console.log(`SKIP ${what}`); return; }
  check(m.every((v, i) => v === (i === n) || m.dead?.[i]), what);
};
const stick = (pad: number, x: number) => w.evaluate(`window.__pads[${pad}].axes[0] = ${x}`).then(() => {});
let m = await moved(() => stick(1, 1), () => stick(1, 0));
only(m, 1, `P2's stick moves only P2 (${m})`);
m = await moved(() => stick(0, -1), () => stick(0, 0));
only(m, 0, `P1's stick moves only P1 (${m})`);
m = await moved(() => w.keyboard.down('KeyD'), () => w.keyboard.up('KeyD'));
only(m, 2, `the keyboard moves only P3 (${m})`);
if (out) await w.screenshot({ path: `${out}/split-match.png` });

await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
