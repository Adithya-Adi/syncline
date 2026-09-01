/**
 * Builds the demo recording the seed installs.
 *
 * A new install has nothing to look at. The viewer is the product, and asking someone to integrate
 * the SDK before they can see it is the wrong order — so `pnpm db:seed` ships one real session, and
 * this is what produces it.
 *
 * Real means real: the recording is made by the shipping SDK driving actual rrweb over an actual
 * DOM, in jsdom, exactly as `tools/record-session.mjs` does against a live API. Nothing here
 * hand-writes an rrweb event. A fixture assembled by hand would drift from the recorder the first
 * time either changed, and the failure would be a blank player rather than a test going red.
 *
 * Two things are faked, both deliberately:
 *
 *   - The network. There is no API to post to and no backend to trace, so `fetch` is answered from
 *     a script. The SDK still patches it, still mints the traceparent, still records the markers.
 *   - Time. `Date.now` is a virtual clock this file advances, so a session that reads as forty
 *     seconds long generates instantly and identically on every machine. Waiting out real time
 *     would make the fixture depend on how loaded the box was when someone regenerated it.
 *
 * Output is `packages/models/prisma/demo/recording.json`, committed, with every timestamp stored as
 * an offset from the session's first event. The seed rebases those onto the moment it runs, so the
 * demo is always a recording from a few minutes ago rather than one dated to whenever this ran.
 *
 * Run it from the repo root after building the SDK:
 *
 *     pnpm nx build browser-sdk
 *     node tools/build-demo-recording.mjs
 */

import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, 'packages/models/prisma/demo/recording.json');

// jsdom is a dev dependency of browser-sdk, not of the workspace root, and pnpm does not hoist it.
// Resolving from that package is what lets this script live in tools/ beside its sibling.
const require = createRequire(join(root, 'packages/browser-sdk/package.json'));
const jsdomModule = await import(pathToFileURL(require.resolve('jsdom')).href);
const { JSDOM } = jsdomModule.default ?? jsdomModule;

const PAGE_ORIGIN = 'http://localhost:4321';
const API = 'http://localhost:4010';

/** Fixed so a regenerated fixture diffs only where the recording actually changed. */
const EPOCH = Date.parse('2026-01-01T12:00:00.000Z');

// ---------------------------------------------------------------------------------------------
// A clock this file controls.
//
// rrweb stamps every event with `Date.now()`, and so does the SDK. Overriding it is what buys a
// forty-second session in a few milliseconds of wall time — and, more importantly, one that is
// byte-identical on every machine that regenerates it.
// ---------------------------------------------------------------------------------------------

let virtualNow = EPOCH;
const realNow = Date.now;
Date.now = () => virtualNow;

/** Moves the clock forward. Nothing here ever waits on real time. */
function advance(ms) {
  virtualNow += ms;
}

// ---------------------------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------------------------

const dom = new JSDOM(
  `<!doctype html><html><head><title>Northwind Supply</title></head><body>
    <header class="topbar">
      <span class="brand">Northwind Supply</span>
      <nav><a href="/">Shop</a> <a href="/cart">Cart</a></nav>
      <span id="cart-count" class="cart-count">0</span>
    </header>
    <main id="view">
      <h1 id="heading">Workshop tools</h1>
      <ul id="catalogue">
        <li data-sku="NW-1042"><span class="name">Bench vice, 4in</span><span class="price">$89.00</span><button class="add">Add to cart</button></li>
        <li data-sku="NW-2277"><span class="name">Torque wrench set</span><span class="price">$142.50</span><button class="add">Add to cart</button></li>
        <li data-sku="NW-3310"><span class="name">Digital calipers</span><span class="price">$36.00</span><button class="add">Add to cart</button></li>
      </ul>
    </main>
    <div id="flash" hidden></div>
  </body></html>`,
  { url: `${PAGE_ORIGIN}/`, pretendToBeVisual: true },
);

// rrweb touches a wide surface of DOM globals, so copy jsdom's whole window rather than
// enumerating them and discovering the next missing one at runtime.
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key in globalThis) continue;
  try {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
    });
  } catch {
    // Some properties refuse redefinition; none of them matter here.
  }
}
for (const name of ['window', 'document', 'navigator', 'location']) {
  Object.defineProperty(globalThis, name, {
    value: dom.window[name],
    configurable: true,
  });
}

// ---------------------------------------------------------------------------------------------
// The network, scripted.
//
// Chunk uploads are captured rather than sent. Everything else is answered from `ROUTES` — which
// is also where the demo's one failure lives, because a recording where nothing goes wrong shows
// none of the reason this product exists.
// ---------------------------------------------------------------------------------------------

/** What the page's own API calls do: how long they take, and what they return. */
const ROUTES = {
  'POST /api/cart': { status: 200, tookMs: 41, body: { items: 1 } },
  'GET /api/inventory': { status: 200, tookMs: 63, body: { available: 12 } },
  'POST /api/checkout': {
    status: 502,
    tookMs: 1180,
    body: { error: 'payment provider unreachable' },
  },
};

const captured = [];

/**
 * Reads a chunk the SDK just posted.
 *
 * Node has `CompressionStream`, so the transport gzips exactly as it does in a browser and the body
 * arrives as a Blob rather than a string. Inflating it here keeps the generator on the real send
 * path instead of a special-cased uncompressed one.
 */
async function readChunkBody(body) {
  if (typeof body === 'string') return JSON.parse(body);
  const bytes = Buffer.from(await new Response(body).arrayBuffer());
  const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return JSON.parse((gzipped ? gunzipSync(bytes) : bytes).toString('utf8'));
}

dom.window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init.method ?? 'GET').toUpperCase();

  if (url.startsWith(`${API}/v1/ingest/session/`)) {
    captured.push({ url, body: await readChunkBody(init.body) });
    return new Response('{}', { status: 202 });
  }

  if (url.startsWith(`${API}/v1/clock`)) {
    // A believable handshake: a few milliseconds of round trip, and a client running slightly
    // fast, so the viewer's clock-uncertainty affordance has something real to describe.
    advance(9);
    return new Response(JSON.stringify({ serverMs: virtualNow + 4 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const route = ROUTES[`${method} ${new URL(url).pathname}`];
  if (!route) throw new Error(`demo script has no route for ${method} ${url}`);

  advance(route.tookMs);
  return new Response(JSON.stringify(route.body), {
    status: route.status,
    headers: { 'content-type': 'application/json' },
  });
};

// ---------------------------------------------------------------------------------------------
// The recording.
// ---------------------------------------------------------------------------------------------

const { startRecording } = await import(
  pathToFileURL(join(root, 'packages/browser-sdk/dist/index.js')).href
);

const recording = startRecording({
  key: 'pk_demo_recording',
  endpoint: API,
  traceOrigins: [PAGE_ORIGIN],
  release: 'northwind-web@4.2.0',
  user: { id: 'u_8823' },
});

const { document } = dom.window;
const $ = (selector) => document.querySelector(selector);

/**
 * Hands the event loop back until rrweb and the SDK have caught up.
 *
 * rrweb batches DOM mutations and emits them on an animation frame, and a route change makes the
 * SDK flush a chunk, write the pageview marker, and take a fresh snapshot — all asynchronously.
 * A script that never yields runs to completion first, and every one of those events then lands in
 * the wrong chunk, attributed to the wrong page.
 *
 * This is real time, unlike everything the recording claims: a few milliseconds of it per beat,
 * while the virtual clock does the storytelling.
 */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

/**
 * A route change.
 *
 * The view is swapped before the URL is pushed, which is the order that produces a truthful
 * keyframe: the SDK snapshots the page after the marker, and a real router has already rendered by
 * then.
 */
async function navigate(path, html, heading) {
  $('#view').innerHTML = `<h1 id="heading">${heading}</h1>${html}`;
  dom.window.history.pushState({}, '', path);
  await settle();
}

// --- Shop -------------------------------------------------------------------------------------

advance(18_000); // browsing the catalogue
$('#catalogue').querySelector('li[data-sku="NW-2277"] .add').className =
  'add pressed';
await settle();
advance(180);

await dom.window.fetch(`${PAGE_ORIGIN}/api/cart`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sku: 'NW-2277', qty: 1 }),
});

$('#cart-count').textContent = '1';
$('#catalogue').querySelector('li[data-sku="NW-2277"] .add').textContent =
  'Added';
await settle();
advance(14_000); // still browsing

// --- Cart -------------------------------------------------------------------------------------

await navigate(
  '/cart',
  `<ul id="lines"><li><span class="name">Torque wrench set</span><span class="qty">1</span><span class="price">$142.50</span></li></ul>
   <p class="total">Total <strong>$142.50</strong></p>
   <button id="checkout">Checkout</button>`,
  'Your cart',
);
advance(6_000);

await dom.window.fetch(`${PAGE_ORIGIN}/api/inventory?sku=NW-2277`, {
  method: 'GET',
});

$('.total').innerHTML = 'Total <strong>$142.50</strong> · in stock';
await settle();
advance(26_500); // deciding

// --- Checkout ---------------------------------------------------------------------------------

await navigate(
  '/checkout',
  `<form id="pay">
     <label>Card <input id="card" value="4242 4242 4242 4242" /></label>
     <label>Expiry <input id="exp" value="04/29" /></label>
     <button id="place">Place order</button>
   </form>
   <p class="summary">1 item · $142.50</p>`,
  'Checkout',
);
advance(11_000); // filling the form

$('#place').className = 'pressed';
await settle();
advance(140);

const checkout = await dom.window.fetch(`${PAGE_ORIGIN}/api/checkout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ items: [{ sku: 'NW-2277', price: 14_250 }] }),
});

// The failure, on screen. This is the frame someone opens the recording to find.
const flash = $('#flash');
flash.hidden = false;
flash.className = 'flash error';
flash.textContent = 'We could not take payment. Please try again.';
$('#place').className = 'add';
await settle();
advance(6_000); // reading the error

$('#place').className = 'pressed';
await settle();
advance(120);
flash.textContent = 'We could not take payment. Please try again. (2)';
await settle();
advance(5_000); // giving up

await recording.flush();
await recording.stop();

Date.now = realNow;

if (checkout.status !== 502) {
  throw new Error(`expected the checkout call to fail, got ${checkout.status}`);
}
if (captured.length === 0) {
  throw new Error('the SDK sent no chunks; nothing to build a fixture from');
}

// ---------------------------------------------------------------------------------------------
// The backend, as spans.
//
// Written here rather than recorded because there is no backend to record — but written against
// the trace ids the SDK actually minted, so the viewer's jump from a request to its trace resolves
// the way it does in a real install. Shapes follow examples/storefront, which is the instrumentation
// a reader of this fixture is most likely to compare it against.
// ---------------------------------------------------------------------------------------------

const chunks = captured.map((entry) => entry.body);
const links = chunks.flatMap((chunk) => chunk.links);

const byPath = (needle) => {
  const link = links.find((candidate) => candidate.url.includes(needle));
  if (!link) throw new Error(`no request link recorded for ${needle}`);
  return link;
};

let spanCounter = 0;
/** Deterministic ids, so a regenerated fixture does not diff on randomness alone. */
function spanId() {
  spanCounter += 1;
  return spanCounter.toString(16).padStart(16, '0');
}

/**
 * A server span for one recorded request, plus its children.
 *
 * `startMs`/`endMs` come from the link the SDK recorded, so the backend sits inside the browser's
 * view of the request rather than floating beside it — which is the whole point of the timeline.
 * Children are laid out sequentially inside the parent's window.
 */
function serverTrace(link, name, attributes, children, status = {}) {
  const parent = spanId();
  const spans = [
    {
      traceId: link.traceId,
      spanId: parent,
      name,
      kind: 'SERVER',
      serviceName: 'northwind-api',
      startOffsetMs: link.startMs + 6,
      durationMs: Math.max(link.endMs - link.startMs - 12, 4),
      statusCode: status.code ?? 'OK',
      ...(status.message ? { statusMsg: status.message } : {}),
      attributes: {
        'http.request.method': link.method,
        'url.path': new URL(link.url).pathname,
        'http.response.status_code': link.status,
        ...attributes,
      },
    },
  ];

  let cursor = link.startMs + 10;
  for (const child of children) {
    spans.push({
      traceId: link.traceId,
      spanId: spanId(),
      parentSpanId: parent,
      name: child.name,
      kind: child.kind ?? 'INTERNAL',
      serviceName: child.serviceName ?? 'northwind-api',
      startOffsetMs: cursor,
      durationMs: child.durationMs,
      statusCode: child.statusCode ?? 'OK',
      ...(child.statusMsg ? { statusMsg: child.statusMsg } : {}),
      attributes: child.attributes ?? {},
    });
    cursor += child.durationMs + 1;
  }

  return spans;
}

const cart = byPath('/api/cart');
const inventory = byPath('/api/inventory');
const order = byPath('/api/checkout');

const spans = [
  ...serverTrace(cart, 'POST /api/cart', { 'cart.sku': 'NW-2277' }, [
    {
      name: 'prisma:query INSERT',
      kind: 'CLIENT',
      durationMs: 9,
      attributes: {
        'db.system': 'postgresql',
        'db.statement': 'INSERT INTO "CartLine" ("sku","qty") VALUES ($1,$2)',
      },
    },
  ]),
  ...serverTrace(
    inventory,
    'GET /api/inventory',
    { 'inventory.sku': 'NW-2277' },
    [
      {
        name: 'prisma:query SELECT',
        kind: 'CLIENT',
        durationMs: 31,
        attributes: {
          'db.system': 'postgresql',
          'db.statement':
            'SELECT "available" FROM "Inventory" WHERE "sku" = $1',
        },
      },
    ],
  ),
  ...serverTrace(
    order,
    'POST /api/checkout',
    { 'checkout.item_count': 1, 'checkout.total_cents': 14_250 },
    [
      {
        name: 'validate cart',
        durationMs: 7,
        attributes: { 'checkout.item_count': 1 },
      },
      {
        name: 'prisma:query SELECT',
        kind: 'CLIENT',
        durationMs: 24,
        attributes: {
          'db.system': 'postgresql',
          'db.statement': 'SELECT * FROM "Cart" WHERE "id" = $1',
        },
      },
      {
        // The reason the order failed, one span deep. Finding this without leaving the replay is
        // the demo's entire argument.
        name: 'POST payments.northwind.internal/charges',
        kind: 'CLIENT',
        serviceName: 'northwind-api',
        durationMs: 1_004,
        statusCode: 'ERROR',
        statusMsg: 'upstream connect timeout',
        attributes: {
          'http.request.method': 'POST',
          'server.address': 'payments.northwind.internal',
          'http.response.status_code': 504,
          'error.type': 'ConnectTimeout',
        },
      },
    ],
    { code: 'ERROR', message: 'payment provider unreachable' },
  ),
];

// ---------------------------------------------------------------------------------------------
// Rebase everything onto the session's first event and write it out.
// ---------------------------------------------------------------------------------------------

const firstEventMs = Math.min(
  ...chunks.flatMap((chunk) =>
    chunk.events
      .map((event) => event.timestamp)
      .filter((ts) => typeof ts === 'number'),
  ),
);

/** rrweb's own stamp, plus the absolute times inside our custom-event payloads. */
function rebaseEvent(event) {
  const out = { ...event, timestamp: event.timestamp - firstEventMs };
  if (out.data?.payload && typeof out.data.payload === 'object') {
    const payload = { ...out.data.payload };
    for (const field of ['startMs', 'endMs']) {
      if (typeof payload[field] === 'number') payload[field] -= firstEventMs;
    }
    out.data = { ...out.data, payload };
  }
  return out;
}

const rebasedChunks = chunks.map((chunk) => ({
  seq: chunk.seq,
  ...(chunk.pageviewOrdinal !== undefined
    ? { pageviewOrdinal: chunk.pageviewOrdinal }
    : {}),
  events: chunk.events.map(rebaseEvent),
  links: chunk.links.map((link) => ({
    ...link,
    startMs: link.startMs - firstEventMs,
    endMs: link.endMs - firstEventMs,
  })),
  pageviews: chunk.pageviews.map((pageview) => ({
    ...pageview,
    startMs: pageview.startMs - firstEventMs,
  })),
}));

const lastEventMs = Math.max(
  ...rebasedChunks.flatMap((chunk) =>
    chunk.events
      .map((event) => event.timestamp)
      .filter((ts) => typeof ts === 'number'),
  ),
);

const fixture = {
  // Regenerate with: pnpm nx build browser-sdk && node tools/build-demo-recording.mjs
  generator: 'tools/build-demo-recording.mjs',
  sdk: chunks[0].sdk,
  clock: chunks[0].clock,
  meta: chunks[0].meta,
  durationMs: lastEventMs,
  chunks: rebasedChunks,
  spans: spans.map((span) => ({
    ...span,
    startOffsetMs: span.startOffsetMs - firstEventMs,
  })),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);

const bytes = JSON.stringify(fixture).length;
console.log(`wrote ${OUT}`);
console.log(
  `  ${fixture.chunks.length} chunks, ` +
    `${fixture.chunks.reduce((n, c) => n + c.events.length, 0)} events, ` +
    `${fixture.chunks.reduce((n, c) => n + c.pageviews.length, 0)} pages, ` +
    `${links.length} requests, ${fixture.spans.length} spans, ` +
    `${Math.round(fixture.durationMs / 1000)}s, ${Math.round(bytes / 1024)}KB`,
);

process.exit(0);
