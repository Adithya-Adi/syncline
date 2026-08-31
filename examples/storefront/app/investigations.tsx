'use client';

import { useStore } from './store';

/** The four requests the example exists to produce. */
export function Investigations() {
  const { cart, clear, call } = useStore();

  async function checkout(items: typeof cart) {
    await call('POST', '/api/checkout', { items });
    if (items.length > 0) clear();
  }

  return (
    <section className="panel">
      <h2>Requests worth investigating</h2>
      <div className="row wrap">
        <button
          type="button"
          className="primary"
          onClick={() => void checkout(cart)}
        >
          Checkout cart ({cart.length})
        </button>
        <button type="button" onClick={() => void checkout([])}>
          Checkout with an empty cart (422)
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => void call('GET', '/api/inventory')}
        >
          Check stock (fails, 500)
        </button>
        <button type="button" onClick={() => void call('GET', '/api/slow')}>
          Sales report (slow, ~1.2s)
        </button>
      </div>
      <p className="hint">
        The 500 carries a failing database span naming a missing table — a cause
        you cannot see from the browser alone. The slow one spends its time in a
        sequential scan.
      </p>
    </section>
  );
}
