// Renders the home-screen icons (public/icon-*.png, apple-touch-icon.png) from the title logo style.
// Usage: npx tsx scripts/make-icons.ts
import { chromium } from 'playwright-core';

const html = (size: number) => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Lilita+One&display=block" rel="stylesheet" />
<style>
  * { margin: 0; }
  body { width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(180deg, #4fa9f2 0%, #9fd5ff 100%); overflow: hidden; }
  .fu { font-family: 'Lilita One'; font-size: ${size * 0.42}px; color: #ff8a3d; transform: rotate(-6deg);
    -webkit-text-stroke: ${size * 0.035}px #3b2a5c; paint-order: stroke fill; text-shadow: 0 ${size * 0.035}px 0 #3b2a5c; }
</style></head><body><div class="fu">FU!</div></body></html>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]] as const) {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(html(size), { waitUntil: 'networkidle' });
  await p.evaluate('document.fonts.ready');
  await p.screenshot({ path: `public/${file}` });
  await p.close();
  console.log(`public/${file}`);
}
await browser.close();
