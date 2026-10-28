// Screenshots pages with the locally installed Google Chrome (playwright-core, no browser download).
// Usage: npx tsx scripts/shot.ts <out.png> <url> [waitMs=4000] [w=1600] [h=900]
import { chromium } from 'playwright-core';

const [out, url, wait = '4000', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
