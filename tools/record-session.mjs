/**
 * End-to-end check for the browser SDK.
 *
 * Runs the real SDK — real rrweb, real fetch patch, real transport — inside jsdom, against a live
 * API. Everything except the browser engine itself is the shipping code path.
 */
import { JSDOM } from 'jsdom';

const API = process.env.SYNCLINE_API ?? 'http://localhost:4010';
const KEY = process.env.SYNCLINE_KEY;
if (!KEY) throw new Error('set SYNCLINE_KEY');

const dom = new JSDOM(
  `<!doctype html><html><body>
     <h1 id="title">Checkout</h1>
     <div id="cart"></div>
     <input id="card" value="4242424242424242" />
   </body></html>`,
  { url: 'http://localhost:3000/checkout', pretendToBeVisual: true },
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
Object.defineProperty(globalThis, 'window', {
  value: dom.window,
  configurable: true,
});
Object.defineProperty(globalThis, 'document', {
  value: dom.window.document,
  configurable: true,
});
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});

// jsdom has no fetch; give the page Node's. The SDK patches whatever is on window.
// A browser sets Origin on every non-GET request, same-origin included. Node's fetch does not,
// so the shim adds it — otherwise the ingest guard correctly rejects every chunk with a 403.
dom.window.fetch = (input, init = {}) => {
  const headers = new Headers(init.headers ?? {});
  if ((init.method ?? 'GET').toUpperCase() !== 'GET')
    headers.set('origin', 'http://localhost:3000');
  return fetch(input, { ...init, headers });
};

const { startRecording } =
  await import('../packages/browser-sdk/dist/index.js');

const recording = startRecording({
  key: KEY,
  endpoint: API,
  // The page is on :3000; the API it calls is the same origin in a real deployment. Here we
  // explicitly allow the API origin so the traceparent is injected.
  traceOrigins: ['http://localhost:3000', API],
  release: 'demo@1.0.0',
  user: { id: 'u_123' },
  debug: true,
});

console.log('session:', recording.sessionId);

// Some DOM activity for rrweb to record.
document.getElementById('cart').innerHTML = '<p>1 item</p>';
document.getElementById('title').textContent = 'Checkout (1)';
await new Promise((r) => setTimeout(r, 300));

// A traced request. This is the one that has to carry a traceparent.
const traced = await dom.window.fetch(`${API}/v1/clock`);
console.log('traced request status:', traced.status);

// A third-party request, which must NOT be traced.
await dom.window
  .fetch('https://example.com/pixel')
  .catch(() => console.log('third-party failed (fine)'));

document.getElementById('cart').innerHTML = '<p>2 items</p>';
await new Promise((r) => setTimeout(r, 300));

await recording.flush();
await recording.stop();
console.log('done');
process.exit(0);
