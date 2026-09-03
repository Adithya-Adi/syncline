/**
 * Environment configuration, validated once at boot.
 *
 * A missing or malformed variable should stop the process at startup with a message naming the
 * variable — not surface as a connection error on the first ingest request an hour later.
 */

import { z } from 'zod';
import {
  DEFAULT_INGEST_BYTES_PER_DAY,
  DEFAULT_INGEST_REQUESTS_PER_MINUTE,
} from '@syncline/protocol';

export const CONFIG = Symbol('SYNCLINE_CONFIG');

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),

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

  /**
   * What one project may send. `0` disables a ceiling.
   *
   * These are the only bounds on *how many* requests arrive — everything else in the ingest path
   * bounds a single one. See DEFAULT_INGEST_* in @syncline/protocol for why the defaults are as
   * generous as they are.
   */
  INGEST_REQUESTS_PER_MINUTE: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_INGEST_REQUESTS_PER_MINUTE),
  INGEST_BYTES_PER_DAY: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_INGEST_BYTES_PER_DAY),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
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
