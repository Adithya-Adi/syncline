import { PRODUCTS } from '@/lib/products';
import { json, preflight, sleep, tracer } from '@/lib/syncline';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return preflight();
}

/** The fast, boring request. One database span underneath it, and nothing to investigate. */
export async function GET(request: Request) {
  const trace = tracer.begin(request, 'GET /api/products', {
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

  const response = json({ products: PRODUCTS });
  await trace.end(200, 'OK');
  return response;
}
