import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { OtlpTracesJob } from '@syncline/protocol';
import { type PrismaClient, type SpanStore } from '@syncline/models';
import { normalizeOtlp } from '@syncline/otlp';
import type { ObjectStore } from '@syncline/storage';
import { UnrecoverableChunkError } from './session-chunk.processor.js';
import { applyServiceNames, type ServiceTx } from './session-services.js';

/**
 * The slice of Prisma the session linkage needs. Structural, so a test can hand it an object.
 */
type LinkTx = ServiceTx & {
  requestLink: {
    findMany(args: unknown): Promise<{ sessionId: string; traceId: string }[]>;
  };
};

/**
 * Turns a stored OTLP batch into span rows.
 *
 * Spans are written through the SpanStore port rather than Prisma directly, so the eventual move
 * to ClickHouse is a new implementation instead of a change here.
 *
 * The batch then updates whichever recordings it belongs to. That linkage has to happen here and
 * not when the chunk arrives, because of the order the two things happen in: the browser posts its
 * recording as it goes, and the backend exports its spans on its own schedule — usually seconds
 * later, occasionally never. A session asked at chunk time whether its backend was instrumented
 * would answer "no" and stay wrong.
 */
export class OtlpTracesProcessor {
  private readonly logger = new Logger(OtlpTracesProcessor.name);

  constructor(
    private readonly spans: SpanStore,
    private readonly storage: ObjectStore,
    private readonly prisma: PrismaClient,
  ) {}

  async process(job: Job<OtlpTracesJob>): Promise<void> {
    const { storageKey } = job.data;

    const raw = await this.storage.getMaybeGzipped(storageKey);

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      throw new UnrecoverableChunkError(
        `${storageKey} is not valid JSON: ${(error as Error).message}`,
      );
    }

    const { spans, dropped } = normalizeOtlp(payload);

    if (dropped > 0) {
      // Logged rather than thrown. A batch is other people's data: one unparseable span must not
      // cost the rest of the batch, but silently discarding it would hide a real producer bug.
      this.logger.warn(`${storageKey}: dropped ${dropped} unparseable span(s)`);
    }

    if (spans.length === 0) {
      this.logger.log(`${storageKey}: no spans`);
      return;
    }

    await this.spans.insert(spans);

    const linked = await linkSpansToSessions(this.prisma, spans);

    this.logger.log(
      `${storageKey}: stored ${spans.length} span(s)` +
        (linked > 0 ? `, updated ${linked} session(s)` : ''),
    );
  }
}

/**
 * Tells the sessions that reference these traces that their backend answered, and with what.
 *
 * A batch is other people's data and most of it has nothing to do with any recording — a cron job,
 * a queue consumer, a request from a service with no browser in front of it. So this starts from
 * the request links, which is the only place a trace id is ever tied to a session, and does nothing
 * at all when none match.
 *
 * Service names are merged rather than replaced. A trace arrives in as many batches as it has
 * services, and each one only knows about its own.
 *
 * Returns how many sessions were touched, for the log.
 */
export async function linkSpansToSessions(
  tx: LinkTx,
  spans: readonly { traceId: string; serviceName: string }[],
): Promise<number> {
  const servicesByTrace = new Map<string, Set<string>>();
  for (const span of spans) {
    const services = servicesByTrace.get(span.traceId) ?? new Set<string>();
    services.add(span.serviceName);
    servicesByTrace.set(span.traceId, services);
  }

  const links = await tx.requestLink.findMany({
    where: { traceId: { in: [...servicesByTrace.keys()] } },
    select: { sessionId: true, traceId: true },
  });
  if (links.length === 0) return 0;

  // One session can reference several of this batch's traces, and the same trace from several
  // requests. Collapse to the set of services each session now knows about.
  const servicesBySession = new Map<string, Set<string>>();
  for (const link of links) {
    const services = servicesBySession.get(link.sessionId) ?? new Set<string>();
    for (const service of servicesByTrace.get(link.traceId) ?? [])
      services.add(service);
    servicesBySession.set(link.sessionId, services);
  }

  return applyServiceNames(tx, servicesBySession);
}
