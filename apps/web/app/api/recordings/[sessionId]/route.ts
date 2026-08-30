import { NextResponse } from 'next/server';
import { recordingForViewer } from '../../../../lib/recordings';
import { requireViewer } from '../../../../lib/session';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const viewer = await requireViewer();
  const recording = await recordingForViewer(viewer, sessionId);

  if (!recording)
    return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json(recording, {
    headers: { 'cache-control': 'no-store' },
  });
}
