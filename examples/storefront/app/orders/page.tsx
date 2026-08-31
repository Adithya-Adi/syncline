'use client';

import { useStore } from '../store';

/** A third route, and the one that makes the slow request easy to reach on its own. */
export default function OrdersPage() {
  const { call } = useStore();

  return (
    <section className="panel">
      <h2>Orders</h2>
      <p className="hint">
        Nothing is stored, so there is nothing to list. The report below is the
        slow request: ~1.2s in a sequential scan, which is what a
        &ldquo;slow&nbsp;session&rdquo; looks like from the outside.
      </p>
      <div className="row wrap">
        <button type="button" onClick={() => void call('GET', '/api/slow')}>
          Run the sales report
        </button>
      </div>
    </section>
  );
}
