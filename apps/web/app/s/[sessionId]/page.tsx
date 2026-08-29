import { Viewer } from './viewer';

/**
 * A single recording.
 *
 * The id is unguessable and that is currently the whole access-control story — see the note on the
 * read endpoints in apps/api. Do not expose this route publicly until real authorization exists.
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <Viewer sessionId={sessionId} />;
}
