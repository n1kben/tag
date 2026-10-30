// Touch controls on a phone (portrait) and an iPad (landscape): the controls appear after a tap,
// the stick moves you, the buttons match your role, holding 🏆 shows the board, key hints hide.
// Usage: npx tsx scripts/check-touch.ts <baseUrl> [outDir]
import { chromium, type CDPSession, type Page } from 'playwright-core';

const [base, out] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number; id: number }[]) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const center = (p: Page, sel: string) => p.evaluate(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, shown: r.width > 0 && getComputedStyle(document.querySelector('${sel}')).display !== 'none' }; })()`) as Promise<{ x: number; y: number; shown: boolean }>;
const server = (p: Page) => p.evaluate('window.__net.server()') as Promise<{ x: number; z: number; alive: boolean; phase: string }>;

for (const dev of [{ name: 'phone portrait', w: 390, h: 844 }, { name: 'iPad landscape', w: 1180, h: 820 }]) {
  const ctx = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await p.goto(`${base}/?practice=1&lite`);
  await touch(cdp, 'touchStart', [{ x: dev.w / 2, y: 10, id: 1 }]); // a first tap switches to touch controls
  await touch(cdp, 'touchEnd', []);
  await p.waitForTimeout(1500);
  const role = await p.evaluate(`document.querySelector('.hud').dataset.role`) as string;
  // Taggers wait out their freeze; runners go during the head start (bots slash idle runners at once)
  if (role === 'TAGGER') for (let i = 0; i < 40; i++) { if ((await server(p)).phase === 'chase') break; await p.waitForTimeout(250); }
  check(await p.evaluate(`document.documentElement.classList.contains('touch') && !!document.querySelector('.tpad.on')`) as boolean, `${dev.name}: controls showing`);
  check(await p.evaluate(`[...document.querySelectorAll('.hud .keys, .hud .inv')].every(e => getComputedStyle(e).display === 'none')`) as boolean, `${dev.name}: keyboard hints hidden`);
  const a1 = await center(p, '.tpad .a1'), a2 = await center(p, '.tpad .a2'), jump = await center(p, '.tpad .jump');
  check(jump.shown && a1.shown && a2.shown === (role === 'RUNNER'), `${dev.name}: ${role} buttons (jump ${jump.shown}, a1 ${a1.shown}, a2 ${a2.shown})`);
  if (out) await p.screenshot({ path: `${out}/touch-${dev.w}x${dev.h}.png` });

  // Drag the stick right for a second, jumping halfway
  const s0 = await server(p);
  const sx = dev.w * 0.2, sy = dev.h * 0.75;
  await touch(cdp, 'touchStart', [{ x: sx, y: sy, id: 1 }]);
  for (let i = 1; i <= 5; i++) await touch(cdp, 'touchMove', [{ x: sx + i * 14, y: sy, id: 1 }]);
  await p.waitForTimeout(500);
  await touch(cdp, 'touchStart', [{ x: sx + 70, y: sy, id: 1 }, { x: jump.x, y: jump.y, id: 2 }]);
  const jumping = await p.evaluate(`!!document.querySelector('.tpad .jump.down')`) as boolean;
  await p.waitForTimeout(500);
  await touch(cdp, 'touchEnd', []); // lifts every finger
  await p.waitForTimeout(300);
  const s1 = await server(p);
  check(jumping, `${dev.name}: jump held while the stick is held (multi-touch)`);
  check(s0.alive && s1.alive ? Math.hypot(s1.x - s0.x, s1.z - s0.z) > 0.3 : true, `${dev.name}: stick moved us (right ${(s1.x - s0.x).toFixed(1)}m${s0.alive && s1.alive ? "" : ", got tagged: inconclusive"})`);

  const board = await center(p, '.tpad [data-b=board]');
  await touch(cdp, 'touchStart', [{ x: board.x, y: board.y, id: 3 }]);
  await p.waitForTimeout(100);
  const boardShown = await p.evaluate(`getComputedStyle(document.querySelector('.board')).display !== 'none'`) as boolean;
  await touch(cdp, 'touchEnd', []);
  await p.waitForTimeout(100);
  const boardGone = await p.evaluate(`getComputedStyle(document.querySelector('.board')).display === 'none'`) as boolean;
  check(boardShown && boardGone, `${dev.name}: holding 🏆 shows the scoreboard`);
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
