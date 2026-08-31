import { db } from './db';

/**
 * How far a project has got through the pipeline.
 *
 * "Nothing here yet" is the least useful thing an onboarding page can say, because four completely
 * different failures produce it: the SDK never ran, it ran but the key was rejected, it recorded
 * but traced nothing, or it traced but the backend never exported. Each rung below distinguishes
 * one of those, so the page can name the step that actually failed.
 */

export type SetupStep = 'waiting' | 'recorded' | 'traced' | 'complete';

/**
 * The most recent captured request, shown as evidence.
 *
 * A count is a claim; a real URL with a real trace id is proof. When someone doubts that the thing
 * they are looking at is their own traffic, this is what settles it.
 */
export interface SetupEvidence {
  sessionId: string;
  method: string;
  url: string;
  traceId: string;
  status?: number;
  /** Whether backend spans have arrived on this exact trace id. */
  stitched: boolean;
}

export interface SetupStatus {
  step: SetupStep;
  recordings: number;
  /** Requests the SDK captured, meaning fetch/XHR patching works. */
  requests: number;
  /** Requests whose trace id resolves to backend spans — the stitch, working end to end. */
  stitched: number;
  latestRecordingId?: string;
  latestRecordingAt?: number;
  latestRequest?: SetupEvidence;
}

export async function setupStatus(projectId: string): Promise<SetupStatus> {
  const [recordings, latest] = await Promise.all([
    db.session.count({ where: { projectId } }),
    db.session.findFirst({
      where: { projectId },
      orderBy: { startedAt: 'desc' },
      select: { id: true, startedAt: true },
    }),
  ]);

  if (recordings === 0) {
    return { step: 'waiting', recordings: 0, requests: 0, stitched: 0 };
  }

  const [links, latestLink] = await Promise.all([
    db.requestLink.findMany({
      where: { session: { projectId } },
      select: { traceId: true },
      // Enough to answer "is anything stitched", without loading a busy project's whole history.
      take: 500,
    }),
    db.requestLink.findFirst({
      where: { session: { projectId } },
      orderBy: { clientStartMs: 'desc' },
      select: {
        sessionId: true,
        method: true,
        url: true,
        traceId: true,
        status: true,
      },
    }),
  ]);

  const base = {
    recordings,
    requests: links.length,
    latestRecordingId: latest?.id,
    latestRecordingAt: latest?.startedAt.getTime(),
  };

  if (links.length === 0) return { ...base, step: 'recorded', stitched: 0 };

  // The newest link is what the page shows as evidence, and it is not necessarily inside the
  // sample above, so it joins the span lookup explicitly rather than being reported unstitched.
  const traceIds = [...new Set(links.map((l) => l.traceId))];
  if (latestLink && !traceIds.includes(latestLink.traceId)) {
    traceIds.push(latestLink.traceId);
  }

  const spans = await db.span.findMany({
    where: { traceId: { in: traceIds } },
    select: { traceId: true },
    distinct: ['traceId'],
  });

  const stitchedTraces = new Set(spans.map((s) => s.traceId));
  const stitched = links.filter((l) => stitchedTraces.has(l.traceId)).length;

  return {
    ...base,
    stitched,
    step: stitched > 0 ? 'complete' : 'traced',
    latestRequest: latestLink
      ? {
          sessionId: latestLink.sessionId,
          method: latestLink.method,
          url: latestLink.url,
          traceId: latestLink.traceId,
          status: latestLink.status ?? undefined,
          stitched: stitchedTraces.has(latestLink.traceId),
        }
      : undefined,
  };
}
