// Practice match: run, jump, and screenshot mid-air to check the jump arc + landing shadow.
// Usage: npx tsx scripts/jump-shots.ts <baseUrl> <outDir>
import { chromium } from 'playwright-core';

const [base, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`${base}/?practice=1`);
await page.waitForTimeout(3500);
const role = (await page.textContent('.role-chip').catch(() => ''))?.trim();
console.log('role', role);
// Taggers are locked during the head start, so wait it out in that case
if (role === 'TAGGER') await page.waitForTimeout(8000);
await page.keyboard.down('KeyS');
await page.waitForTimeout(350);
await page.keyboard.down('Space');
await page.waitForTimeout(170);
await page.screenshot({ path: `${outDir}/jump-rise.png` });
await page.waitForTimeout(150);
await page.keyboard.up('Space');
await page.screenshot({ path: `${outDir}/jump-fall.png` });
await page.keyboard.up('KeyS');
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/jump-after.png` });
await browser.close();
