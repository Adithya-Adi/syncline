import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 moved the connection URL out of schema.prisma, and no longer loads .env by itself —
 * hence the dotenv import above. The CLI reads the URL from here; the runtime client gets it
 * through a driver adapter instead (see packages/models/src/client.ts).
 */
export default defineConfig({
  schema: 'packages/models/prisma/schema.prisma',
  migrations: {
    path: 'packages/models/prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
