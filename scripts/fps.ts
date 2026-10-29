// Measures render fps of the title-screen city flyover in headless Chrome (software GL),
// a rough proxy for scene cost. Usage: npx tsx scripts/fps.ts <url> [url2 …]
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const url of process.argv.slice(2)) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto(url, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(2500);
  // Passed as a string: tsx's injected helpers don't exist inside the page
  const fps = await p.evaluate<number>(`new Promise(res => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); };
    requestAnimationFrame(f);
  })`);
  await p.keyboard.press('KeyP');
  await p.waitForTimeout(1200);
  const info = (await p.textContent('.debug').catch(() => '')) ?? '';
  console.log(`${url}  ${fps.toFixed(1)} fps  ${info.replace(/.*?(draws.*)/, '$1')}`);
  await p.close();
}
await browser.close();
