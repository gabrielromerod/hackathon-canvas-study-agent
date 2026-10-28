// Render the stage page frame by frame with Playwright.
// usage: node render.mjs <stage.html> <rawDir> <outDir> <fromFrame> <toFrameExclusive> [step]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [page_, rawDir, outDir, from, to, step = '1'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto('file://' + path.resolve(page_) + '?raw=' + encodeURIComponent('file://' + path.resolve(rawDir)));
await page.evaluate(() => window.ready);
const t0 = Date.now();
for (let f = Number(from); f < Number(to); f += Number(step)) {
  await page.evaluate((n) => window.render(n), f);
  await page.screenshot({ path: path.join(outDir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
}
console.log('frames', from, to, 'in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await browser.close();
