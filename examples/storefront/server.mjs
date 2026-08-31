import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Tracer } from './otlp.mjs';

/**
 * The example storefront's server.
 *
 * Two jobs: serve the page that records itself, and behave like a backend worth investigating —
 * fast requests, a slow one, a failing one, and database work underneath each. Every response
 * exports spans on the trace id the browser minted, which is what makes the replay, the request
 * bar, and the span tree line up in the viewer.
 *
 * No dependencies. `node server.mjs` is the whole thing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const env = { ...(await loadDotEnv(join(here, '.env'))), ...process.env };

const PORT = Number(env['PORT'] ?? 4321);
const ENDPOINT = (env['SYNCLINE_ENDPOINT'] ?? 'http://localhost:4000').replace(
  /\/+$/,
  '',
);
const PUBLIC_KEY = env['SYNCLINE_PUBLIC_KEY'] ?? '';
const SECRET_KEY = env['SYNCLINE_SECRET_KEY'] ?? '';
const RELEASE = env['SYNCLINE_RELEASE'] ?? 'storefront@1.0.0';

/**
 * Reproduces the failure the setup doctor hunts for.
 *
 * With this set, the API stops advertising `traceparent` in Access-Control-Allow-Headers. Requests
 * from this page still work — they are same-origin, so no preflight happens — but a cross-origin
 * probe starts failing, which is exactly the shape of the bug in a real deployment: it looks like
 * Syncline broke the site, and it is a CORS setting.
 */
const BREAK_CORS = env['BREAK_CORS'] === '1';

/** The bundle the browser SDK's build produces. Serving it is the "script tag" install path. */
const SDK_BUNDLE = join(
  here,
  '..',
  '..',
  'packages',
  'browser-sdk',
  'dist',
  'index.js',
);

const tracer = new Tracer({
  endpoint: ENDPOINT,
  secretKey: SECRET_KEY,
  serviceName: 'storefront-api',
});

const PRODUCTS = [
  { sku: 'SYN-001', name: 'Field notebook', price: 1800, stock: 42 },
  { sku: 'SYN-002', name: 'Mechanical pencil', price: 2400, stock: 17 },
  { sku: 'SYN-003', name: 'Timeline poster', price: 3200, stock: 8 },
  { sku: 'SYN-004', name: 'Trace-id mug', price: 1500, stock: 0 },
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  try {
    if (path === '/' || path === '/index.html')
      return await sendFile(
        res,
        join(here, 'public', 'index.html'),
        'text/html',
      );
    if (path === '/app.js')
      return await sendFile(
        res,
        join(here, 'public', 'app.js'),
        'text/javascript',
      );
    if (path === '/styles.css')
      return await sendFile(
        res,
        join(here, 'public', 'styles.css'),
        'text/css',
      );
    if (path === '/config.js') return sendConfig(res);
    if (path === '/js/syncline.js') return await sendSdk(res);

    if (path === '/api/products') return await products(req, res);
    if (path === '/api/checkout' && req.method === 'POST')
      return await checkout(req, res);
    if (path === '/api/inventory') return await inventory(req, res);
    if (path === '/api/slow') return await slowReport(req, res);

    // Client-side routes are real URLs in the recording, so they have to survive a reload.
    if (path === '/cart' || path === '/orders')
      return await sendFile(
        res,
        join(here, 'public', 'index.html'),
        'text/html',
      );

    json(res, 404, { error: 'not found', path });
  } catch (error) {
    console.error('unhandled', error);
    json(res, 500, { error: 'internal error' });
  }
});

// Without this, a port already in use exits on an unhandled 'error' event and prints a stack
// trace — the least helpful possible answer to "the example did not start".
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  Port ${PORT} is already in use.`);
    console.error(
      '  Another copy of this example is probably still running. Stop it, or set PORT in .env',
    );
    console.error(
      `  — remember to add the new origin to the project's allowlist if you change it.`,
    );
    console.error('');
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  const ready = PUBLIC_KEY.startsWith('pk_');

  console.log('');
  console.log(`  syncline example storefront   http://localhost:${PORT}`);
  console.log(`  ingest endpoint               ${ENDPOINT}`);
  console.log(
    `  public key                    ${ready ? `${PUBLIC_KEY.slice(0, 11)}…` : 'MISSING'}`,
  );
  console.log(
    `  secret key                    ${SECRET_KEY.startsWith('sk_') ? 'set' : 'MISSING — no backend spans'}`,
  );
  if (BREAK_CORS) {
    console.log(
      '  BREAK_CORS=1                  traceparent is NOT allowed by CORS',
    );
  }
  console.log('');

  if (!ready) {
    console.log("  Copy .env.example to .env and fill in this project's keys.");
    console.log(
      `  The project's allowed origins must include http://localhost:${PORT}`,
    );
    console.log('');
  }
});

/* ------------------------------------------------------------------ routes */

async function products(req, res) {
  const trace = tracer.begin(req, 'GET /api/products', {
    'syncline.example.route': 'products',
  });

  const query = trace.child(
    'SELECT products',
    {
      'db.system': 'postgresql',
      'db.name': 'storefront',
      'db.statement': 'SELECT sku, name, price, stock FROM products LIMIT 50',
      'db.rows_affected': PRODUCTS.length,
    },
    'CLIENT',
  );
  await sleep(18 + Math.random() * 22);
  query.end('OK');

  json(res, 200, { products: PRODUCTS });
  await trace.end(200, 'OK');
}

async function checkout(req, res) {
  const body = await readJson(req);
  const items = Array.isArray(body?.items) ? body.items : [];

  const trace = tracer.begin(req, 'POST /api/checkout', {
    'syncline.example.route': 'checkout',
    'checkout.item_count': items.length,
    'checkout.total_cents': items.reduce(
      (total, item) => total + (Number(item?.price) || 0),
      0,
    ),
  });

  const validate = trace.child('validate cart', {
    'checkout.item_count': items.length,
  });
  await sleep(6);
  validate.end('OK');

  // An empty cart is a real failure with a useful shape: the request fails, the span carries the
  // reason, and the replay shows the click that caused it.
  if (items.length === 0) {
    json(res, 422, { error: 'cart is empty' });
    await trace.end(422, 'ERROR', 'cart is empty');
    return;
  }

  const insert = trace.child(
    'INSERT orders',
    {
      'db.system': 'postgresql',
      'db.name': 'storefront',
      'db.statement':
        'INSERT INTO orders (id, total_cents, status) VALUES ($1, $2, $3)',
    },
    'CLIENT',
  );
  await sleep(40 + Math.random() * 60);
  insert.end('OK');

  const charge = trace.child(
    'POST payments.example/charges',
    {
      'http.request.method': 'POST',
      'server.address': 'payments.example',
      'payment.provider': 'example',
    },
    'CLIENT',
  );
  await sleep(90 + Math.random() * 80);
  charge.end('OK');

  const orderId = `ord_${Math.random().toString(36).slice(2, 10)}`;
  json(res, 201, { orderId, items: items.length });
  await trace.end(201, 'OK');
}

/**
 * The failing route.
 *
 * Deliberately a 500 with an error span rather than a 4xx: the point of the example is to have one
 * request whose failure has a backend cause you can only see in the trace.
 */
async function inventory(req, res) {
  const trace = tracer.begin(req, 'GET /api/inventory', {
    'syncline.example.route': 'inventory',
  });

  const query = trace.child(
    'SELECT inventory',
    {
      'db.system': 'postgresql',
      'db.name': 'storefront',
      'db.statement':
        'SELECT sku, on_hand FROM inventory_snapshot WHERE region = $1',
    },
    'CLIENT',
  );
  await sleep(25);
  query.end('ERROR', 'relation "inventory_snapshot" does not exist');

  json(res, 500, {
    error: 'inventory lookup failed',
    hint: 'Open the trace for this request — the failing span names the missing table.',
  });
  await trace.end(500, 'ERROR', 'relation "inventory_snapshot" does not exist');
}

/** The slow route, so the viewer has something worth measuring. */
async function slowReport(req, res) {
  const trace = tracer.begin(req, 'GET /api/slow', {
    'syncline.example.route': 'slow-report',
  });

  const scan = trace.child(
    'SELECT sales_report',
    {
      'db.system': 'postgresql',
      'db.name': 'storefront',
      'db.statement': 'SELECT day, sum(total_cents) FROM orders GROUP BY day',
      'db.scan': 'sequential',
    },
    'CLIENT',
  );
  await sleep(1100);
  scan.end('OK');

  const render = trace.child('render report', {});
  await sleep(120);
  render.end('OK');

  json(res, 200, { rows: 37, generatedAt: new Date().toISOString() });
  await trace.end(200, 'OK');
}

/* ----------------------------------------------------------------- serving */

function sendConfig(res) {
  // The public key belongs in the page — that is what makes it public. The secret key never leaves
  // this process, which is the distinction the two key kinds exist to draw.
  const config = {
    key: PUBLIC_KEY,
    endpoint: ENDPOINT,
    release: RELEASE,
    origin: `http://localhost:${PORT}`,
  };

  res.writeHead(200, {
    'content-type': 'text/javascript',
    'cache-control': 'no-store',
  });
  res.end(`window.SYNCLINE_CONFIG = ${JSON.stringify(config)};\n`);
}

async function sendSdk(res) {
  try {
    const bundle = await readFile(SDK_BUNDLE);
    res.writeHead(200, {
      'content-type': 'text/javascript',
      'cache-control': 'no-store',
    });
    res.end(bundle);
  } catch {
    // A missing bundle is the one setup failure this example can diagnose itself, so it says the
    // command rather than serving a 404 that looks like a broken import.
    res.writeHead(503, { 'content-type': 'text/javascript' });
    res.end(
      'console.error("syncline: the SDK bundle is missing. Run: pnpm nx build browser-sdk");\n',
    );
  }
}

async function sendFile(res, path, contentType) {
  const body = await readFile(path);
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * CORS wide enough for a demo, and narrow in the one place that matters.
 *
 * `traceparent` is the header the browser SDK adds to traced requests. An API that does not name it
 * here fails every traced request at the preflight, which is the single most common way a Syncline
 * integration appears to break the host application.
 */
function cors(res) {
  const allowed = ['content-type'];
  if (!BREAK_CORS) allowed.push('traceparent');

  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', allowed.join(', '));
  res.setHeader('access-control-max-age', '600');
}

/* ------------------------------------------------------------------- utils */

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) return null;
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/** Enough .env parsing for KEY=value, so the example needs no dependency to read its own config. */
async function loadDotEnv(path) {
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch {
    return {};
  }

  const out = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) out[key] = value;
  }
  return out;
}
