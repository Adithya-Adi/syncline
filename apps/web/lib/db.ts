import { createPrismaClientFromEnv, type PrismaClient } from '@syncline/models';

/**
 * One Prisma client for the web app.
 *
 * Cached on `globalThis` because Next's dev server re-evaluates modules on every edit, and a fresh
 * client per reload exhausts the connection pool within a few minutes of ordinary work.
 */
const globalForPrisma = globalThis as unknown as {
  synclinePrisma?: PrismaClient;
};

export const db: PrismaClient =
  globalForPrisma.synclinePrisma ?? createPrismaClientFromEnv();

if (process.env.NODE_ENV !== 'production') globalForPrisma.synclinePrisma = db;
