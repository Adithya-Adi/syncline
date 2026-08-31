'use client';

import Link from 'next/link';
import { money } from '@/lib/products';
import { useStore } from '../store';

/**
 * A second route, so the recording contains client-side navigation.
 *
 * `next/link` navigations are route changes rather than page loads, which is the case worth
 * exercising: the recording has to stay one continuous session across them.
 */
export default function CartPage() {
  const { cart, clear, call } = useStore();
  const total = cart.reduce((sum, item) => sum + item.price, 0);

  return (
    <section className="panel">
      <h2>Cart</h2>
      {cart.length === 0 ? (
        <p className="hint">
          Empty. <Link href="/">Add something on the shop page</Link> — the cart
          survives navigation because the recorder and the cart both live above
          the router.
        </p>
      ) : (
        <>
          <ul className="products">
            {cart.map((item, index) => (
              <li key={`${item.sku}-${index}`}>
                <span className="sku">{item.sku}</span>
                <span className="name">{item.name}</span>
                <span className="price">{money(item.price)}</span>
                <span />
              </li>
            ))}
          </ul>
          <div className="row wrap">
            <strong>{money(total)}</strong>
            <button
              type="button"
              className="primary"
              onClick={async () => {
                await call('POST', '/api/checkout', { items: cart });
                clear();
              }}
            >
              Checkout
            </button>
          </div>
        </>
      )}
    </section>
  );
}
