import { createPrismaClientFromEnv, type PrismaClient } from '@syncline/models';

/**
 * One Prisma client for the web app, created on first use rather than on import.
 *
 * The laziness is load-bearing. `next build` evaluates every page module to collect its config,
 * including pages marked `force-dynamic`, and a client constructed at module scope reads
 * DATABASE_URL right then — failing the build on any machine without a database, which is every CI
 * runner. Building should not require infrastructure.
 *
 * Cached on `globalThis` because Next's dev server re-evaluates modules on each edit, and a fresh
 * client per reload exhausts the connection pool within a few minutes of ordinary work.
 */
const globalForPrisma = globalThis as unknown as {
  synclinePrisma?: PrismaClient;
};

function client(): PrismaClient {
  if (!globalForPrisma.synclinePrisma) {
    globalForPrisma.synclinePrisma = createPrismaClientFromEnv();
  }
  return globalForPrisma.synclinePrisma;
}

/**
 * A proxy so call sites stay `db.user.count()` rather than `getDb().user.count()`. Nothing is
 * constructed until a property is actually read, which only happens while serving a request.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(client(), property, receiver);
  },
  has(_target, property) {
    return Reflect.has(client(), property);
  },
});
