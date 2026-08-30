import { chunkForViewer } from '../../../../../../lib/recordings';
import { requireViewer } from '../../../../../../lib/session';

/**
 * Serves the stored rrweb bytes exactly as they arrived, gzip and all.
 *
 * Inflating here only to have the response recompressed on the way out would be work for its own
 * sake, so `content-encoding` is set from the bytes and the browser does it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; seq: string }> },
) {
  const { sessionId, seq } = await params;
  const viewer = await requireViewer();
  const bytes = await chunkForViewer(viewer, sessionId, Number(seq));

  if (!bytes)
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
    });

  const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/json',
      ...(gzipped ? { 'content-encoding': 'gzip' } : {}),
      // Chunks are immutable once written. Private, because this response is now tied to a session.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
}
