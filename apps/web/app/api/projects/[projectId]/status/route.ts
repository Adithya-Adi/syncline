import { NextResponse } from 'next/server';
import { projectForViewer, requireViewer } from '../../../../../lib/session';
import { setupStatus } from '../../../../../lib/setup-status';

/**
 * Polled by the setup page while it waits for a first recording.
 *
 * Scoped through the viewer's organization like every other project lookup, so polling someone
 * else's project id returns 404 rather than leaking whether it exists.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const viewer = await requireViewer();
  const project = await projectForViewer(viewer, projectId);

  if (!project)
    return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json(await setupStatus(project.id), {
    headers: { 'cache-control': 'no-store' },
  });
}
