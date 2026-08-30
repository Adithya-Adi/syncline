/**
 * Drives the viewer the way a person does: open the list, click through to a recording, zoom into
 * a request, reset.
 *
 * Distinct from viewer-check.mjs, which asserts that a session renders correctly. This one asserts
 * that the interactions work, which is where the zoom regressions would show up.
 *
 * Usage:
 *   node tools/interaction-check.mjs        (needs api, worker and web running)
 */
import { chromium } from 'playwright';

const WEB = 'http://localhost:3000';
const SESSION = '01M18E7F43QV5W1MSVHCJ8ZY9N';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));

// The list first: is it a real way in?
await page.goto(`${WEB}/sessions`, { waitUntil: 'networkidle' });
const list = await page.evaluate(() => ({
  rows: document.querySelectorAll('.list__row').length,
  firstHref: document.querySelector('.list__row')?.getAttribute('href') ?? null,
}));
console.log('list rows:', list.rows, ' first href:', list.firstHref);

await page.click('.list__row');
await page.waitForTimeout(2500);
console.log('navigated to:', new URL(page.url()).pathname);

const before = await page.evaluate(() => ({
  ticks: [...document.querySelectorAll('.strata__tick')].map(
    (n) => n.textContent,
  ),
  barWidths: [...document.querySelectorAll('.bar')].map((n) =>
    Math.round(n.getBoundingClientRect().width),
  ),
  hasFocusBar: !!document.querySelector('.strata__focus'),
}));
console.log('\nbefore zoom');
console.log('  ruler :', before.ticks.join('  '));
console.log('  bars  :', before.barWidths.map((w) => w + 'px').join(', '));
console.log('  focus bar shown:', before.hasFocusBar);

await page.click('.bar');
await page.waitForTimeout(400);

const after = await page.evaluate(() => ({
  ticks: [...document.querySelectorAll('.strata__tick')].map(
    (n) => n.textContent,
  ),
  barWidths: [...document.querySelectorAll('.bar')].map((n) =>
    Math.round(n.getBoundingClientRect().width),
  ),
  focusLabel:
    document.querySelector('.strata__focus .eyebrow')?.textContent ?? null,
  detail: document.querySelector('.detail__name')?.textContent ?? null,
  attrs: [...document.querySelectorAll('.detail__attr dt')].map(
    (n) => n.textContent,
  ),
}));
console.log('\nafter clicking a bar');
console.log('  ruler :', after.ticks.join('  '));
console.log('  bars  :', after.barWidths.map((w) => w + 'px').join(', '));
console.log('  focus :', after.focusLabel);
console.log('  detail:', after.detail, '| attrs:', after.attrs.join(', '));

await page.screenshot({ path: process.env.SHOT ?? 'zoom.png' });

await page.click('.strata__fit');
await page.waitForTimeout(300);
const reset = await page.evaluate(() => ({
  ticks: [...document.querySelectorAll('.strata__tick')].map(
    (n) => n.textContent,
  ),
  hasFocusBar: !!document.querySelector('.strata__focus'),
}));
console.log('\nafter Fit whole recording');
console.log('  ruler :', reset.ticks.join('  '));
console.log('  focus bar gone:', !reset.hasFocusBar);

if (problems.length)
  console.log('\npage errors:', [...new Set(problems)].slice(0, 5));
await browser.close();
process.exit(0);
