import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  OTLP_TRACES_QUEUE,
  SESSION_CHUNK_QUEUE,
  type OtlpTracesJob,
  type SessionChunkJob,
} from '@syncline/protocol';
import { createPrismaClient, PostgresSpanStore } from '@syncline/models';
import { ObjectStore } from '@syncline/storage';
import { loadConfig } from './config.js';
import { SessionChunkProcessor } from './app/session-chunk.processor.js';
import { OtlpTracesProcessor } from './app/otlp-traces.processor.js';

const logger = new Logger('Worker');

async function bootstrap() {
  const config = loadConfig();

  const prisma = createPrismaClient({
    url: config.DATABASE_URL,
    maxConnections: config.DATABASE_MAX_CONNECTIONS,
    log: config.DATABASE_LOG,
  });
  await prisma.$connect();
  logger.log('database connected');

  const storage = new ObjectStore({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });
  // The API creates the bucket at boot too. The worker checks rather than assumes, because in a
  // real deployment there is no guaranteed start order between the two.
  logger.log(`bucket "${storage.bucket}" ${await storage.ensureBucket()}`);

  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  const chunks = new SessionChunkProcessor(prisma, storage);
  const traces = new OtlpTracesProcessor(
    new PostgresSpanStore(prisma),
    storage,
  );

  const workers = [
    new Worker<SessionChunkJob>(
      SESSION_CHUNK_QUEUE,
      (job: Job<SessionChunkJob>) => chunks.process(job),
      { connection, concurrency: config.WORKER_CONCURRENCY },
    ),
    new Worker<OtlpTracesJob>(
      OTLP_TRACES_QUEUE,
      (job: Job<OtlpTracesJob>) => traces.process(job),
      { connection, concurrency: config.WORKER_CONCURRENCY },
    ),
  ];

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      logger.error(
        `${worker.name} job ${job?.id ?? '?'} failed: ${error.message}`,
      );
    });
    worker.on('error', (error) =>
      logger.error(`${worker.name}: ${error.message}`),
    );
  }

  logger.log(
    `consuming ${SESSION_CHUNK_QUEUE} and ${OTLP_TRACES_QUEUE} at concurrency ${config.WORKER_CONCURRENCY}`,
  );

  /**
   * Close the workers before anything they depend on.
   *
   * `worker.close()` waits for in-flight jobs to finish. Tearing down Redis or the database first
   * would fail those jobs at the last moment, and a job that was nearly done would be retried from
   * the start for no reason.
   */
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, draining`);
    await Promise.all(workers.map((w) => w.close()));
    connection.disconnect();
    await prisma.$disconnect();
    logger.log('stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
