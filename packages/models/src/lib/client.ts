/**
 * Prisma client construction.
 *
 * Prisma 7 no longer reads a connection URL from schema.prisma. The runtime gets one through a
 * driver adapter — here `pg` — while the CLI reads its own from prisma.config.ts. Two paths to the
 * same database, which is worth knowing when only one of them is misconfigured.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type { PrismaClient };

export interface DatabaseOptions {
  url: string;
  /**
   * Upper bound on connections held by one process. Both apps/api and apps/worker open their own
   * pool, so this is per process, not per deployment.
   */
  maxConnections?: number;
  log?: boolean;
}

export function createPrismaClient(options: DatabaseOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.maxConnections ?? 10,
  });

  return new PrismaClient({
    adapter,
    log: options.log ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/**
 * Reads DATABASE_URL and fails loudly if it is missing.
 *
 * A missing URL surfaces here, at startup, rather than as a connection error on the first ingest
 * request half an hour later.
 */
export function createPrismaClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PrismaClient {
  const url = env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env for local development.',
    );
  }

  return createPrismaClient({
    url,
    maxConnections: env['DATABASE_MAX_CONNECTIONS']
      ? Number(env['DATABASE_MAX_CONNECTIONS'])
      : undefined,
    log: env['DATABASE_LOG'] === 'true',
  });
}
