import 'dotenv/config';
import { MAX_SERVICE_NAMES } from '../src/lib/session-index.js';
import { createPrismaClientFromEnv } from '../src/lib/client.js';

/**
 * Repairs sessions that have spans but say they do not.
 *
 * `hasBackendSpans` used to be set only when an OTLP batch arrived, on the reasoning that spans
 * come after the recording. Usually they do, but an exporter that flushes in a second beats a
 * five-second chunk interval — and when it won, the request link did not exist yet, the update was
 * skipped, and nothing ever retried. Those sessions still have their spans; only the flag and the
 * `service` search key are missing, so the recordings list reports an instrumented project as
 * uninstrumented and `service:` finds nothing.
 *
 * Both ingest paths set it now, so this is only needed once, for rows written before that fix.
 *
 *   pnpm db:backfill:spans           # report what would change
 *   pnpm db:backfill:spans --apply   # write it
 *
 * Safe to re-run. It only ever adds services to a session and sets a flag to true, so a second run
 * finds nothing left to do.
 */

const APPLY = process.argv.includes('--apply');
const BATCH = 200;

const db = createPrismaClientFromEnv();

let scanned = 0;
let repaired = 0;
let cursor: string | undefined;

for (;;) {
  const sessions = await db.session.findMany({
    where: { hasBackendSpans: false },
    orderBy: { id: 'asc' },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: BATCH,
    select: {
      id: true,
      projectId: true,
      serviceNames: true,
      links: { select: { traceId: true } },
    },
  });

  if (sessions.length === 0) break;
  cursor = sessions[sessions.length - 1]!.id;
  scanned += sessions.length;

  for (const session of sessions) {
    const traceIds = [...new Set(session.links.map((link) => link.traceId))];
    if (traceIds.length === 0) continue;

    // Distinct service names, straight from the spans that already exist.
    const rows = await db.span.findMany({
      where: { traceId: { in: traceIds } },
      select: { serviceName: true },
      distinct: ['serviceName'],
    });
    if (rows.length === 0) continue;

    // Sorted before capping, so which names survive is the same here as in the ingest path.
    const serviceNames = [
      ...new Set([...session.serviceNames, ...rows.map((r) => r.serviceName)]),
    ]
      .sort()
      .slice(0, MAX_SERVICE_NAMES);

    repaired += 1;
    console.log(
      `${APPLY ? 'repairing' : 'would repair'} ${session.id}  ${serviceNames.join(', ')}`,
    );

    if (!APPLY) continue;

    await db.session.update({
      where: { id: session.id },
      data: { hasBackendSpans: true, serviceNames },
    });

    // The searchable half, matching what the ingest path writes.
    await db.sessionAttribute.createMany({
      data: serviceNames.map((value) => ({
        sessionId: session.id,
        projectId: session.projectId,
        key: 'service',
        value,
      })),
      skipDuplicates: true,
    });
  }
}

console.log(
  `\nscanned ${scanned} session(s) with hasBackendSpans=false, ${repaired} had spans`,
);
if (!APPLY && repaired > 0) console.log('re-run with --apply to write.');

await db.$disconnect();
