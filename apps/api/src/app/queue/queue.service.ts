import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  DEFAULT_JOB_OPTIONS,
  OTLP_TRACES_QUEUE,
  SESSION_CHUNK_QUEUE,
  type OtlpTracesJob,
  type SessionChunkJob,
} from '@syncline/protocol';
import { CONFIG, type AppConfig } from '../config/config.js';

/**
 * Hands work to apps/worker.
 *
 * Job payloads carry storage keys, never bodies — Redis is a queue, not a blob store. Keeping jobs
 * small is what lets the queue absorb a spike the parsing stage could not.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection: IORedis;
  private readonly sessionChunks: Queue<SessionChunkJob>;
  private readonly otlpTraces: Queue<OtlpTracesJob>;

  constructor(@Inject(CONFIG) config: AppConfig) {
    // The URL is passed to ioredis positionally. Handing BullMQ `{ url }` as connection options
    // looks like it works and does not: ioredis has no `url` option, so it silently falls back to
    // localhost:6379 and the failure only appears as a refused connection on the first enqueue.
    this.connection = new IORedis(config.REDIS_URL, {
      // BullMQ requires this. It blocks on reads, and a capped retry count turns a brief Redis
      // hiccup into permanently dead workers.
      maxRetriesPerRequest: null,
    });

    this.sessionChunks = new Queue(SESSION_CHUNK_QUEUE, {
      connection: this.connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.otlpTraces = new Queue(OTLP_TRACES_QUEUE, {
      connection: this.connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  /**
   * The job id makes redelivery harmless at the queue level, before the worker's own idempotency
   * has to do anything: a retried upload of the same chunk collapses into one job.
   *
   * It is keyed on the *body* as well as the slot, and that part is not decoration. Keyed on
   * `(session, seq)` alone, a chunk uploaded a second time with different content was silently
   * dropped — the object at that key had already been replaced, so the recording became the new
   * bytes indexed by the old row's timings. Content in the key means an identical retry still
   * collapses, while a replacement is treated as the new work it is.
   *
   * `:` is reserved in BullMQ key names and is rejected outright, hence the double underscore.
   */
  async enqueueSessionChunk(
    job: SessionChunkJob,
    /** Short digest of the stored body. Omitted only by callers with nothing to hash. */
    bodyDigest?: string,
  ): Promise<void> {
    const id = bodyDigest
      ? `${job.sessionId}__${job.seq}__${bodyDigest}`
      : `${job.sessionId}__${job.seq}`;

    await this.sessionChunks.add('chunk', job, { jobId: id });
  }

  async enqueueOtlpTraces(job: OtlpTracesJob): Promise<void> {
    await this.otlpTraces.add('traces', job);
  }

  /** Reports whether Redis is actually reachable, for the health endpoint. */
  async ping(): Promise<boolean> {
    try {
      return (await this.connection.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.sessionChunks.close(), this.otlpTraces.close()]);
    this.connection.disconnect();
    this.logger.log('queues closed');
  }
}
