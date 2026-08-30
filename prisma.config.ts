import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moved the connection URL out of schema.prisma, and no longer loads .env by itself —
 * hence the dotenv import above. The CLI reads the URL from here; the runtime client gets it
 * through a driver adapter instead (see packages/models/src/lib/client.ts).
 *
 * The datasource is attached only when DATABASE_URL is actually set, and `process.env` is read
 * directly rather than through Prisma's `env()` helper, which throws on a missing variable while
 * the config is being loaded. `prisma generate` needs no database — it reads the schema and writes
 * TypeScript — and it runs from postinstall, including in CI where no .env exists. Requiring a
 * connection string there would fail the install of a repo that had not been configured yet.
 *
 * Commands that genuinely need a database (`migrate`, `db seed`, `studio`) still fail without it,
 * which is correct: they have nothing to connect to.
 */
const url = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'packages/models/prisma/schema.prisma',
  migrations: {
    path: 'packages/models/prisma/migrations',
    seed: 'tsx packages/models/prisma/seed.ts',
  },
  ...(url ? { datasource: { url } } : {}),
});
