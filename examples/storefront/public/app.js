import { startRecording } from '/js/syncline.js';

/**
 * The example storefront's front end.
 *
 * Plain ES modules, no build step: the SDK is served as the browser bundle its own build produces,
 * which is the same "script tag" install the setup page documents. Everything interesting here is
 * in the first twenty lines — the rest is a storefront to click on.
 */

const config = window.SYNCLINE_CONFIG ?? {};

/**
 * The user id is remembered so that reloading keeps the same identity, and editable so that
 * searching for a specific customer's session has something to find.
 */
const USER_KEY = 'syncline-example-user';

function currentUserId() {
  try {
    const stored = localStorage.getItem(USER_KEY);
    if (stored) return stored;
  } catch {
    // Storage is refused in some privacy modes. A fresh id per load is a fine fallback.
  }

  const generated = `u_${Math.random().toString(36).slice(2, 8)}`;
  try {
    localStorage.setItem(USER_KEY, generated);
  } catch {
    /* not fatal */
  }
  return generated;
}

const userId = currentUserId();

const recording = startRecording({
  key: config.key,
  endpoint: config.endpoint,
  // Only this origin. The SDK never adds a traceparent to anybody else's domain, which is what
  // keeps an internal trace id out of a third party's logs.
  traceOrigins: [window.location.origin],
  release: config.release,
  user: { id: userId },
  debug: true,
});

document.getElementById('session').textContent =
  `${userId} · ${recording.sessionId}`;
document.getElementById('user-id').value = userId;

/* ------------------------------------------------------------------- state */

const cart = [];

/* ------------------------------------------------------------------ wiring */

document.getElementById('identity').addEventListener('submit', (event) => {
  event.preventDefault();
  const next = document.getElementById('user-id').value.trim();
  if (!next) return;

  try {
    localStorage.setItem(USER_KEY, next);
  } catch {
    /* not fatal */
  }

  // A reload rather than a live swap: the SDK sets identity when the session starts, so a new
  // identity honestly means a new session.
  window.location.reload();
});

document.body.addEventListener('click', (event) => {
  const route = event.target.closest('a[data-route]');
  if (route) {
    // Client-side navigation, so the recording contains route changes rather than page loads.
    event.preventDefault();
    history.pushState({}, '', route.getAttribute('href'));
    log(`navigated to ${route.getAttribute('href')}`);
    return;
  }

  const action = event.target.closest('button[data-action]')?.dataset.action;
  if (!action) return;

  if (action === 'checkout') void checkout(cart);
  if (action === 'checkout-empty') void checkout([]);
  if (action === 'inventory') void call('GET', '/api/inventory');
  if (action === 'slow') void call('GET', '/api/slow');
});

/* ------------------------------------------------------------------ actions */

async function loadProducts() {
  const list = document.getElementById('products');

  try {
    const { products } = await call('GET', '/api/products');
    list.innerHTML = '';

    for (const product of products) {
      const item = document.createElement('li');
      item.innerHTML = `
        <span class="sku">${product.sku}</span>
        <span class="name">${product.name}</span>
        <span class="price">${money(product.price)}</span>
      `;

      const add = document.createElement('button');
      add.className = 'ghost';
      add.textContent = product.stock > 0 ? 'Add to cart' : 'Out of stock';
      add.disabled = product.stock === 0;
      add.addEventListener('click', () => {
        cart.push(product);
        log(`added ${product.name} — cart has ${cart.length}`);
      });

      item.appendChild(add);
      list.appendChild(item);
    }
  } catch {
    list.innerHTML = '<li class="empty">Could not load products.</li>';
  }
}

async function checkout(items) {
  await call('POST', '/api/checkout', { items });
  if (items.length > 0) cart.length = 0;
}

/**
 * One place where every request is made, so every request is traced the same way.
 *
 * Nothing here mentions Syncline: `fetch` is already patched by the time this runs, and that is the
 * point — instrumenting a call site is not something an application should have to remember.
 */
async function call(method, path, body) {
  const started = performance.now();

  const response = await fetch(path, {
    method,
    ...(body
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });

  const elapsed = Math.round(performance.now() - started);
  const payload = await response.json().catch(() => ({}));

  log(
    `${method} ${path} → ${response.status} in ${elapsed}ms${
      payload.error ? ` · ${payload.error}` : ''
    }`,
    response.ok ? 'ok' : 'bad',
  );

  return payload;
}

/* -------------------------------------------------------------------- view */

function log(message, tone = 'ok') {
  const list = document.getElementById('log');
  list.querySelector('.empty')?.remove();

  const entry = document.createElement('li');
  entry.className = tone;
  entry.textContent = `${new Date().toISOString().slice(11, 19)}  ${message}`;
  list.prepend(entry);

  while (list.children.length > 12) list.lastElementChild.remove();
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

void loadProducts();
