import { json, preflight, sleep, tracer } from '@/lib/syncline';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return preflight();
}

/**
 * The interesting success path: three nested spans, one of them a call to somebody else.
 *
 * An empty cart is a deliberate failure with a useful shape — the request fails, the span carries
 * the reason, and the replay shows the click that caused it.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    items?: { sku?: string; price?: number }[];
  } | null;
  const items = Array.isArray(body?.items) ? body.items : [];

  const trace = tracer.begin(request, 'POST /api/checkout', {
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

  if (items.length === 0) {
    const response = json({ error: 'cart is empty' }, 422);
    await trace.end(422, 'ERROR', 'cart is empty');
    return response;
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
  const response = json({ orderId, items: items.length }, 201);
  await trace.end(201, 'OK');
  return response;
}
