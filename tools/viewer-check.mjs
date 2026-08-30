/**
 * Renders the viewer in a real browser against a mock API.
 *
 * Usage:
 *   pnpm nx build web && (cd apps/web && pnpm exec next start -p 3000)
 *   node tools/viewer-check.mjs
 *
 * Requires Failed to install browsers
Error: Invalid installation targets: 'chromium'. Expecting one of: android, chrome, chrome-beta, chrome-for-testing, chromium, chromium-headless-shell, chromium-tip-of-tree, chromium-tip-of-tree-headless-shell, ffmpeg, firefox, firefox-beta, msedge, msedge-beta, msedge-dev, webkit, webkit-wsl, winldd once.
 *
 * The rrweb events are genuine — captured by running rrweb under jsdom — so the player is fed the
 * same shape of data the SDK produces. Only the API is faked, which is what makes this runnable
 * without Postgres, Redis or MinIO.
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const SESSION_ID = '01M162M23ZCFG6DZ0BXSFB9M43';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const API_PORT = 4000;
const WEB = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

// With SYNCLINE_SESSION set, the mock is skipped entirely and the viewer is pointed at whatever is
// already serving the API — the real one.
const REAL_SESSION = process.env.SYNCLINE_SESSION;

// ---------------------------------------------------------------- fixtures

async function captureEvents() {
  // Only needed for the mock path, and it lives in the SDK package rather than at the root.
  const { JSDOM } =
    await import('../packages/browser-sdk/node_modules/jsdom/lib/api.js');

  const dom = new JSDOM(
    `<!doctype html><html><body>
       <h1 id="title">Checkout</h1><div id="cart"></div>
     </body></html>`,
    { url: 'http://localhost:3000/checkout', pretendToBeVisual: true },
  );

  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue;
    try {
      Object.defineProperty(globalThis, key, {
        value: dom.window[key],
        configurable: true,
      });
    } catch {
      /* some properties refuse redefinition; none matter here */
    }
  }
  for (const k of ['window', 'document', 'navigator']) {
    Object.defineProperty(globalThis, k, {
      value: dom.window[k] ?? dom.window,
      configurable: true,
    });
  }

  const { record } = await import('rrweb');
  const events = [];
  const stop = record({ emit: (e) => events.push(e) });

  dom.window.document.getElementById('cart').innerHTML = '<p>1 item</p>';
  await new Promise((r) => setTimeout(r, 250));
  dom.window.document.getElementById('title').textContent = 'Checkout (1)';
  await new Promise((r) => setTimeout(r, 250));
  dom.window.document.getElementById('cart').innerHTML = '<p>2 items</p>';
  await new Promise((r) => setTimeout(r, 250));
  stop?.();

  return events;
}

const events = REAL_SESSION ? [] : await captureEvents();
const first = REAL_SESSION ? Date.now() : events[0].timestamp;
const last = REAL_SESSION ? first + 1000 : events[events.length - 1].timestamp;

const session = {
  id: SESSION_ID,
  startedMs: first,
  endedMs: last,
  durationMs: last - first,
  clock: { offsetMs: 4, rttMs: 140 }, // rtt over the threshold, so the band must be drawn
  meta: {
    url: 'http://localhost:3000/checkout',
    userAgent: 'Mozilla/5.0',
    release: 'demo@1.0.0',
    user: { id: 'u_123' },
    viewport: { w: 1024, h: 768 },
  },
  chunks: [
    {
      seq: 0,
      startedMs: first,
      endedMs: last,
      eventCount: events.length,
      sizeBytes: 2601,
      url: `/v1/sessions/${SESSION_ID}/chunks/0`,
    },
  ],
  links: [
    {
      traceId: TRACE_ID,
      spanId: '00f067aa0ba902b7',
      method: 'POST',
      url: 'http://localhost:3000/api/checkout',
      status: 500,
      startMs: first + 120,
      endMs: first + 480,
    },
  ],
};

const trace = {
  traceId: TRACE_ID,
  uncertaintyMs: 70,
  spans: [
    {
      spanId: 'aaf067aa0ba902b7',
      depth: 0,
      name: 'POST /api/checkout',
      serviceName: 'checkout-api',
      kind: 'SERVER',
      startClientMs: first + 130,
      endClientMs: first + 470,
      durationMs: 340,
      status: 'ERROR',
      attributes: { 'http.status_code': 500 },
    },
    {
      spanId: 'bbf067aa0ba902b7',
      parentSpanId: 'aaf067aa0ba902b7',
      depth: 1,
      name: 'prisma:query SELECT',
      serviceName: 'checkout-api',
      kind: 'CLIENT',
      startClientMs: first + 180,
      endClientMs: first + 450,
      durationMs: 270,
      status: 'UNSET',
      attributes: {
        'db.system': 'postgresql',
        'db.statement': 'SELECT * FROM cart',
      },
    },
  ],
};

// ------------------------------------------------------------- mock server

const server = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json');

  if (req.url === `/v1/sessions/${SESSION_ID}`)
    return res.end(JSON.stringify(session));
  if (req.url === `/v1/sessions/${SESSION_ID}/chunks/0`)
    return res.end(JSON.stringify({ events }));
  if (req.url === `/v1/traces/${TRACE_ID}`)
    return res.end(JSON.stringify(trace));

  res.statusCode = 404;
  res.end('{}');
});
if (!REAL_SESSION) {
  await new Promise((r) => server.listen(API_PORT, r));
  console.log(`mock api on :${API_PORT} — ${events.length} real rrweb events`);
} else {
  console.log(`using the live API for session ${REAL_SESSION}`);
}

// ------------------------------------------------------------------ render

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`${WEB}/s/${REAL_SESSION ?? SESSION_ID}`, {
  waitUntil: 'networkidle',
});
await page.waitForTimeout(2500);

const report = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const core = q('.core');
  return {
    notice: q('.notice')?.textContent ?? null,
    railFields: qa('.railbar__field').length,
    lanes: qa('.lane__label').map((n) => n.textContent.trim()),
    bars: qa('.bar').length,
    errorBars: qa('.bar--error').length,
    ticks: qa('.strata__tick').length,
    hasCore: !!core,
    coreLeft: core ? getComputedStyle(core).left : null,
    coreReadout: q('.core__readout')?.textContent ?? null,
    hasBand: !!q('.uncertainty'),
    bandWidth: q('.uncertainty')
      ? getComputedStyle(q('.uncertainty')).width
      : null,
    playerCanvas: !!q('.rr-player'),
    strataVisible: (() => {
      const el = q('.strata');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.bottom <= window.innerHeight + 1 && r.top > 0;
    })(),
    detailVisible: (() => {
      const el = q('.detail');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.bottom <= window.innerHeight + 1;
    })(),
    pageScrolls: document.documentElement.scrollHeight > window.innerHeight,
    playerWidth: q('.rr-player')
      ? getComputedStyle(q('.rr-player')).width
      : null,
  };
});

console.log('\n--- render report ---');
for (const [k, v] of Object.entries(report)) console.log(`  ${k}:`, v);

// Does the core actually track the player?
const before = report.coreLeft;
await page.click('.rr-controller__btns button').catch(() => {});
await page.waitForTimeout(260);
await page.click('.rr-controller__btns button').catch(() => {}); // pause mid-recording
await page.waitForTimeout(300);
const after = await page.evaluate(() => {
  const c = document.querySelector('.core');
  return {
    left: c ? getComputedStyle(c).left : null,
    readout: document.querySelector('.core__readout')?.textContent,
  };
});
console.log('\n--- after pressing play ---');
console.log('  core left before:', before);
console.log('  core left after :', after.left);
console.log('  readout         :', after.readout);
console.log('  core moved      :', before !== after.left);

const shot = process.env.SCREENSHOT ?? 'viewer.png';
await page.screenshot({ path: shot, fullPage: false });
console.log(`\nscreenshot: ${shot}`);

if (problems.length) {
  console.log('\n--- browser problems ---');
  for (const p of [...new Set(problems)].slice(0, 10)) console.log('  ' + p);
}

await browser.close();
if (!REAL_SESSION) server.close();
process.exit(0);
