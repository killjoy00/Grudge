import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = (process.env.SITE_URL || 'https://grudge.planitnow.us').replace(/\/$/, '');
const out = process.env.UX_OUT || 'ux-audit-output';
await fs.mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];
const routes = [
  ['home', '/'],
  ['standings', '/standings?season=2026'],
  ['predictions', '/predictions'],
  ['trades', '/trades'],
  ['players', '/players'],
];

const report = { base, generatedAt: new Date().toISOString(), pages: [] };

async function settle(page, url) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  return response;
}

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();

  for (const [name, path] of routes) {
    const url = `${base}${path}`;
    const response = await settle(page, url);
    await page.screenshot({ path: `${out}/${name}-${viewport.name}.png`, fullPage: true });

    const metrics = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const offenders = Array.from(document.querySelectorAll('body *'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
            text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width),
          };
        })
        .filter((x) => x.width > 0 && (x.right > vw + 3 || x.left < -3))
        .slice(0, 30);

      const nav = document.querySelector('nav.tabs');
      return {
        title: document.title,
        bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200),
        viewportWidth: vw,
        documentScrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > vw + 2,
        offenders,
        nav: nav ? {
          clientWidth: nav.clientWidth,
          scrollWidth: nav.scrollWidth,
          scrollLeft: nav.scrollLeft,
          canScroll: nav.scrollWidth > nav.clientWidth + 2,
        } : null,
      };
    });

    report.pages.push({ viewport: viewport.name, name, path, status: response?.status() ?? null, ...metrics });

    if (name === 'home' && viewport.name === 'mobile') {
      const nav = page.locator('nav.tabs');
      if (await nav.count()) {
        await nav.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${out}/mobile-nav-scrolled.png`, fullPage: false });
      }

      const wireHeading = page.getByText(/league wire/i).first();
      if (await wireHeading.count()) {
        const section = wireHeading.locator('xpath=ancestor::*[self::section or self::div][1]');
        try { await section.screenshot({ path: `${out}/league-wire-mobile.png` }); } catch {}
      }
    }
  }

  if (viewport.name === 'mobile') {
    await settle(page, `${base}/`);
    const href = await page.locator('a[href^="/matchup/"]').first().getAttribute('href').catch(() => null);
    if (href) {
      const response = await settle(page, `${base}${href}`);
      await page.screenshot({ path: `${out}/matchup-preview-mobile.png`, fullPage: true });
      report.matchup = { href, status: response?.status() ?? null };
    }
  }

  await context.close();
}

await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
