/**
 * Environment configuration, validated once at boot.
 *
 * A missing or malformed variable should stop the process at startup with a message naming the
 * variable — not surface as a connection error on the first ingest request an hour later.
 */

import { z } from 'zod';

export const CONFIG = Symbol('SYNCLINE_CONFIG');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
        'Copy .env.example to .env for local development.'
    );
  }

  return result.data;
}
