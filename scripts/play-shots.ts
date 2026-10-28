// Drives the real client in local Chrome: title screen, then a practice match with movement,
// screenshotting along the way. Usage: npx tsx scripts/play-shots.ts <baseUrl> <outDir>
import { chromium, type Page } from 'playwright-core';

const [base, outDir] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

async function newPage(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', m => {
    const t = m.text();
    if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('GL Driver') && !t.includes('favicon')) console.log(`[${m.type()}]`, t);
  });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  return page;
}

const title = await newPage();
await title.goto(base, { waitUntil: 'load' });
await title.waitForTimeout(2500);
await title.screenshot({ path: `${outDir}/p0-title.png` });
await title.close();

const page = await newPage();
await page.goto(`${base}/?practice=1`, { waitUntil: 'load' });
const shots: [number, string, string[]][] = [
  [2500, 'p1-hide', ['KeyD']],
  [4000, 'p2-run', ['KeyW', 'KeyD']],
  [9000, 'p3-seek', ['KeyA']],
  [10000, 'p4-later', []],
];
for (const [wait, name, keys] of shots) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  for (const k of keys) await page.keyboard.up(k);
}
await browser.close();
console.log('done');
