import { json, preflight, sleep, tracer } from '@/lib/syncline';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return preflight();
}

/** The slow route, so the viewer has something worth measuring rather than only something to read. */
export async function GET(request: Request) {
  const trace = tracer.begin(request, 'GET /api/slow', {
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

  const response = json({ rows: 37, generatedAt: new Date().toISOString() });
  await trace.end(200, 'OK');
  return response;
}
