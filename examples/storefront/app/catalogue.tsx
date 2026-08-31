'use client';

import { useEffect, useState } from 'react';
import { money, type Product } from '@/lib/products';
import { useStore } from './store';

/** The fast request, and the only one that runs without being asked. */
export function Catalogue() {
  const { add, call, note } = useStore();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const payload = (await call('GET', '/api/products')) as {
          products?: Product[];
        };
        if (!cancelled) setProducts(payload.products ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [call]);

  return (
    <section className="panel">
      <h2>Products</h2>
      <p className="hint">
        <code>GET /api/products</code> — fast, one database span.
      </p>
      <ul className="products">
        {failed && <li className="empty">Could not load products.</li>}
        {!failed && products === null && <li className="empty">Loading…</li>}
        {products?.map((product) => (
          <li key={product.sku}>
            <span className="sku">{product.sku}</span>
            <span className="name">{product.name}</span>
            <span className="price">{money(product.price)}</span>
            <button
              type="button"
              className="ghost"
              disabled={product.stock === 0}
              onClick={() => {
                add(product);
                note(`added ${product.name}`);
              }}
            >
              {product.stock > 0 ? 'Add to cart' : 'Out of stock'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
