import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { OtlpTracesJob } from '@syncline/protocol';
import type { SpanStore } from '@syncline/models';
import { normalizeOtlp } from '@syncline/otlp';
import type { ObjectStore } from '@syncline/storage';
import { UnrecoverableChunkError } from './session-chunk.processor.js';

/**
 * Turns a stored OTLP batch into span rows.
 *
 * Spans are written through the SpanStore port rather than Prisma directly, so the eventual move
 * to ClickHouse is a new implementation instead of a change here.
 */
export class OtlpTracesProcessor {
  private readonly logger = new Logger(OtlpTracesProcessor.name);

  constructor(
    private readonly spans: SpanStore,
    private readonly storage: ObjectStore,
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
    this.logger.log(`${storageKey}: stored ${spans.length} span(s)`);
  }
}
