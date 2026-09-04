import { MAX_SERVICE_NAMES } from '@syncline/models';

/**
 * Recording which backend services a session turned out to touch.
 *
 * Called from both ingest paths, and that is the point. A session and its spans arrive on separate
 * schedules — the browser posts chunks as it records, the backend exports spans when its batcher
 * decides to — and neither order is unusual. Whichever lands second is the one that can finally
 * see both halves, so both have to be able to complete the link.
 *
 * It used to run only when spans arrived. That reads as the safe choice, because spans usually
 * come later, but "usually" was doing the work: an exporter that flushes in a second beats a
 * five-second chunk interval, the link does not exist yet, and the update is skipped and never
 * retried. The result is a session with spans in the database and `hasBackendSpans: false` on the
 * row, telling the recordings list that a project which is instrumented is not.
 */

/** The slice of Prisma this needs. Structural, so a test can hand it an object. */
export type ServiceTx = {
  session: {
    findMany(args: unknown): Promise<
      {
        id: string;
        projectId: string;
        serviceNames: string[];
        hasBackendSpans: boolean;
      }[]
    >;
    update(args: unknown): Promise<unknown>;
  };
  sessionAttribute: {
    createMany(args: unknown): Promise<unknown>;
  };
};

/** Two sorted lists, compared. */
function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Merges the given services into each session and marks it as having backend spans.
 *
 * Returns how many rows actually changed. Idempotent: a redelivered batch, or the other ingest
 * path arriving at the same conclusion, finds nothing to say and writes nothing.
 */
export async function applyServiceNames(
  tx: ServiceTx,
  servicesBySession: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<number> {
  if (servicesBySession.size === 0) return 0;

  const sessions = await tx.session.findMany({
    where: { id: { in: [...servicesBySession.keys()] } },
    select: {
      id: true,
      projectId: true,
      serviceNames: true,
      hasBackendSpans: true,
    },
  });

  let updated = 0;

  for (const session of sessions) {
    const merged = new Set([
      ...session.serviceNames,
      ...(servicesBySession.get(session.id) ?? []),
    ]);

    // Sorted before capping, so which names survive the cap is the same on every delivery —
    // insertion order would make it depend on which batch arrived first. See MAX_SERVICE_NAMES.
    const serviceNames = [...merged].sort().slice(0, MAX_SERVICE_NAMES);

    // Nothing new to say. Skipping keeps a redelivered batch — or a service exporting in many
    // small batches — from rewriting the same row once per batch, and it is compared against the
    // final list rather than the merged set so a session at the cap settles instead of churning.
    if (session.hasBackendSpans && same(serviceNames, session.serviceNames)) {
      continue;
    }
    updated += 1;

    await tx.session.update({
      where: { id: session.id },
      data: { hasBackendSpans: true, serviceNames },
    });

    // The searchable half. `skipDuplicates` rather than a diff: services are only ever added to a
    // session, so there is nothing here that can become stale.
    await tx.sessionAttribute.createMany({
      data: serviceNames.map((value) => ({
        sessionId: session.id,
        projectId: session.projectId,
        key: 'service',
        value,
      })),
      skipDuplicates: true,
    });
  }

  return updated;
}
