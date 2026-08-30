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

export interface SetupStatus {
  step: SetupStep;
  recordings: number;
  /** Requests the SDK captured, meaning fetch/XHR patching works. */
  requests: number;
  /** Requests whose trace id resolves to backend spans — the stitch, working end to end. */
  stitched: number;
  latestRecordingId?: string;
  latestRecordingAt?: number;
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

  const links = await db.requestLink.findMany({
    where: { session: { projectId } },
    select: { traceId: true },
    // Enough to answer "is anything stitched", without loading a busy project's whole history.
    take: 500,
  });

  const base = {
    recordings,
    requests: links.length,
    latestRecordingId: latest?.id,
    latestRecordingAt: latest?.startedAt.getTime(),
  };

  if (links.length === 0) return { ...base, step: 'recorded', stitched: 0 };

  const traceIds = [...new Set(links.map((l) => l.traceId))];
  const spans = await db.span.findMany({
    where: { traceId: { in: traceIds } },
    select: { traceId: true },
    distinct: ['traceId'],
  });

  const stitchedTraces = new Set(spans.map((s) => s.traceId));
  const stitched = links.filter((l) => stitchedTraces.has(l.traceId)).length;

  return { ...base, stitched, step: stitched > 0 ? 'complete' : 'traced' };
}
