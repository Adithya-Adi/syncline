import { notFound } from 'next/navigation';

import { RecordingsSurface } from '../../../recordings-surface';
import { projectForViewer, requireViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ProjectRecordingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { projectId } = await params;
  const { all } = await searchParams;
  const viewer = await requireViewer();
  const project = await projectForViewer(viewer, projectId);
  if (!project) notFound();

  return (
    <RecordingsSurface
      viewer={viewer}
      project={{ id: project.id, name: project.name }}
      showAll={all === '1'}
    />
  );
}
