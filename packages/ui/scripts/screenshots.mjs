#!/usr/bin/env node
// Screenshots of /design and /design/report at 390, 768 and 1440px, light and dark.
// Needs a running web app: `pnpm --filter @tracer/web build && pnpm --filter @tracer/web start`.
// Usage: node scripts/screenshots.mjs [baseUrl=http://localhost:3000] [--sections <dir>]
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// Playwright is not a dependency: it is expected to be installed globally (NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright');

const base = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:3000';
const sectionsIdx = process.argv.indexOf('--sections');
const sectionsDir = sectionsIdx > 0 ? process.argv[sectionsIdx + 1] : null;
const out = fileURLToPath(new URL('../screenshots/', import.meta.url));
mkdirSync(out, { recursive: true });

const widths = [390, 768, 1440];
const schemes = ['light', 'dark'];
const pages = [
  ['design', '/design'],
  ['report', '/design/report'],
];

const browser = await chromium.launch();
for (const scheme of schemes) {
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    for (const [name, path] of pages) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) console.warn(`! ${name} ${width}px ${scheme}: horizontal overflow ${overflow}px`);
      const file = `${out}${name}-${width}-${scheme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log('wrote', file);
      if (sectionsDir) {
        mkdirSync(sectionsDir, { recursive: true });
        const ids = await page.evaluate(() => [...document.querySelectorAll('section[id], article[id], header')].map((e, i) => e.id || `h${i}`));
        let i = 0;
        for (const el of await page.$$('section[id], article[id], body > div > header, .rp-hero')) {
          const box = await el.boundingBox();
          if (!box || box.height < 20) continue;
          await el.screenshot({ path: `${sectionsDir}/${name}-${width}-${scheme}-${String(i).padStart(2, '0')}-${ids[i] ?? 'x'}.png` }).catch(() => {});
          i++;
        }
      }
    }
    await ctx.close();
  }
}
await browser.close();
