import { json, preflight, sleep, tracer } from '@/lib/syncline';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return preflight();
}

/**
 * The failing route.
 *
 * A 500 rather than a 4xx, and the cause lives only in the trace: the browser sees "inventory lookup
 * failed", and the failing span names the missing table. That gap is the entire argument for
 * stitching the two timelines together.
 */
export async function GET(request: Request) {
  const trace = tracer.begin(request, 'GET /api/inventory', {
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

  const response = json(
    {
      error: 'inventory lookup failed',
      hint: 'Open the trace for this request — the failing span names the missing table.',
    },
    500,
  );
  await trace.end(500, 'ERROR', 'relation "inventory_snapshot" does not exist');
  return response;
}
