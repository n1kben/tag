// Spectates a practice match and screenshots right after kills and grenade detonations,
// to eyeball the slice / blast effects in real play. Usage: npx tsx scripts/juice-shots.ts <baseUrl> <outDir>
import { chromium } from 'playwright-core';

const [base, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));

const wanted = new Map<string, number>([['kill', 3], ['det_frost', 1], ['det_flash', 1], ['det_boom', 1], ['det_smoke', 1]]);
let busy = false;
page.on('websocket', ws => ws.on('framereceived', async f => {
  const t = String(f.payload);
  if (busy || !t.startsWith('{"type":"ev"')) return;
  const msg = JSON.parse(t) as { events: { k: string; kind?: string }[] };
  for (const e of msg.events) {
    const key = e.k === 'det' ? `det_${e.kind}` : e.k;
    const left = wanted.get(key);
    if (!left) continue;
    wanted.set(key, left - 1);
    busy = true;
    await new Promise(r => setTimeout(r, key === 'det_smoke' ? 900 : 120));
    await page.screenshot({ path: `${outDir}/j-${key}-${left}.png` }).catch(() => {});
    console.log('shot', key);
    busy = false;
    return;
  }
}));
await page.goto(`${base}/?practice=1`);
const end = Date.now() + 150_000;
while (Date.now() < end && [...wanted.values()].some(v => v > 0)) await page.waitForTimeout(1000);
console.log('remaining', Object.fromEntries(wanted));
await browser.close();
