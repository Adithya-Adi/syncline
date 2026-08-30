import { z } from 'zod';

/**
 * The worker declares the environment it needs rather than sharing the API's schema. They overlap
 * heavily today, but the two processes are deployed and scaled separately, and a shared schema
 * would quietly require the worker to hold configuration it never reads.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  DATABASE_URL: z.string().min(1),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().optional(),
  DATABASE_LOG: z.stringbool().default(false),

  REDIS_URL: z.string().min(1),

  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),

  /** Jobs processed in parallel per queue, per process. */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = schema.safeParse(env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        'Copy .env.example to .env for local development.',
    );
  }

  return result.data;
}
