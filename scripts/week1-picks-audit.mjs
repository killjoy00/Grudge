import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const out = process.env.UX_OUT || 'ux-audit-output';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const response = await page.goto('http://127.0.0.1:3000/ux-audit-picks', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/picks-fixture-${viewport.name}.png`, fullPage: true });
  const metrics = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return {
      viewportWidth: vw,
      documentScrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > vw + 2,
      heads: Array.from(document.querySelectorAll('.matchup-head')).map((el) => ({
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        overflow: el.scrollWidth > el.clientWidth + 1,
        text: (el.textContent || '').trim().replace(/\s+/g, ' '),
      })),
    };
  });
  results.push({ viewport: viewport.name, status: response?.status() ?? null, ...metrics });
  await page.close();
}

await fs.writeFile(`${out}/picks-report.json`, JSON.stringify(results, null, 2));
await browser.close();
console.log(JSON.stringify(results, null, 2));
