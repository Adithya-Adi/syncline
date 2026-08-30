import { NextResponse } from 'next/server';
import { traceForViewer } from '../../../../../../lib/recordings';
import { requireViewer } from '../../../../../../lib/session';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ traceId: string }> },
) {
  const { traceId } = await params;
  const viewer = await requireViewer();
  const trace = await traceForViewer(viewer, traceId);

  if (!trace) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json(trace, {
    headers: { 'cache-control': 'private, max-age=60' },
  });
}
