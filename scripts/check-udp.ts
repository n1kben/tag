// Real browser, real server: does the WebRTC data channel open, and do snapshots arrive over
// it? Also checks ?udp=0 stays on the WebSocket and still plays.
// Run (dev servers up): npx tsx scripts/check-udp.ts http://localhost:8080
import { chromium, type Page } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8080';
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function probe(page: Page, ms: number): Promise<{ transport: string; snaps: number }> {
  const end = Date.now() + ms;
  let last = { transport: 'none', snaps: 0 };
  while (Date.now() < end) {
    last = await page.evaluate(`(() => { const n = window.__net; return n ? { transport: n.transport(), snaps: n.stats.snaps } : { transport: 'none', snaps: 0 }; })()`) as typeof last;
    if (last.transport === 'udp' && last.snaps > 30) break;
    await new Promise(r => setTimeout(r, 250));
  }
  return last;
}

for (const [query, want] of [['', 'udp'], ['&udp=0', 'ws']] as const) {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('pageerror', e => { console.log('[pageerror]', e.message); failures++; });
  await page.goto(`${base}/?practice=dm&lite${query}`); // deathmatch: if we get tagged we're back in 2s
  const first = await probe(page, 8000);
  const before = first.snaps;
  await new Promise(r => setTimeout(r, 2000));
  const after = await probe(page, 100);
  check(first.transport === want, `${query || 'default'}: transport ${first.transport} (want ${want})`);
  check(after.snaps - before > 40, `${query || 'default'}: snapshots flowing (${after.snaps - before} in 2s)`);
  // Inputs: hold a direction; the server must ack them and move us
  type Srv = { ack: number; x: number; z: number; alive: boolean; phase: string; frozen: number; stun: number };
  const srv = () => page.evaluate('window.__net.server()') as Promise<Srv>;
  // ?practice=1 skips the title clicks, so the room-code box still has focus: blur it like a click would
  await page.evaluate('document.activeElement && document.activeElement.blur()');
  const s0 = await srv();
  // A teammate can be standing right next to us (players are solid), so try each direction
  let moved = 0;
  for (const key of ['KeyD', 'KeyA', 'KeyW', 'KeyS']) {
    // Only count a try while we can move: alive, past the head start, not frozen or dizzy
    for (let i = 0; i < 60; i++) {
      const st = await srv();
      if (st.alive && st.phase === 'chase' && !st.frozen && !st.stun) break;
      await new Promise(r => setTimeout(r, 200));
    }
    const a = await srv();
    await page.keyboard.down(key);
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.up(key);
    await new Promise(r => setTimeout(r, 250));
    const b = await srv();
    if (a.alive && b.alive) moved = Math.max(moved, Math.hypot(b.x - a.x, b.z - a.z));
  }
  const s1 = await srv();
  check(s1.ack - s0.ack > 60, `${query || 'default'}: server ran our inputs (ack +${s1.ack - s0.ack})`);
  check(moved > 1, `${query || 'default'}: and moved us (${moved.toFixed(1)}m)`);
  await page.close();
}
await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
process.exit(failures ? 1 : 0);
