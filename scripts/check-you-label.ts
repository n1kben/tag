// Checks the local "YOU" tag wears the team colour (teal runner / red tagger), over a few practice starts.
// Usage: npx tsx scripts/check-you-label.ts <baseUrl>
import { chromium } from 'playwright-core';

const [base] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const seen = new Map<string, string>();
let failures = 0;
for (let i = 0; i < 4 && seen.size < 2; i++) {
  const p = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  await p.goto(`${base}/?practice=1&lite`);
  await p.waitForTimeout(4000);
  const r = await p.evaluate(`(() => {
    const you = [...document.querySelectorAll('.tagp')].find(e => e.textContent === 'YOU');
    return { role: document.querySelector('.hud').dataset.role, you: you ? getComputedStyle(you).backgroundColor : null };
  })()`) as { role: string; you: string | null };
  const expected = r.role === 'RUNNER' ? 'rgb(20, 191, 160)' : 'rgb(239, 118, 122)';
  const ok = r.you === expected;
  if (!ok) failures++;
  seen.set(r.role, r.you ?? 'none');
  console.log(`${ok ? 'PASS' : 'FAIL'} role ${r.role}: YOU tag ${r.you} (expected ${expected})`);
  await p.close();
}
await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : `ALL PASS (roles seen: ${[...seen.keys()].join(', ')})`);
process.exit(failures ? 1 : 0);
