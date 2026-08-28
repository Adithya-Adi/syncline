# @syncline/models

The Prisma schema, the generated client, and the storage ports built on top of it.

```
prisma/schema.prisma          the data model (docs/ARCHITECTURE.md §6)
prisma/migrations/            SQL, generated from the schema
src/lib/client.ts             PrismaClient construction via the pg driver adapter
src/lib/span-store.ts         the SpanStore port and its Postgres implementation
src/generated/prisma/         generated, gitignored, recreated by `pnpm db:generate`
```

## Prisma 7 notes

Two things changed under us and are worth knowing before editing anything here.

**The connection URL is not in the schema.** Prisma 7 removed `datasource.url`. The CLI reads it
from `prisma.config.ts` at the workspace root; the runtime gets it through a driver adapter
(`@prisma/adapter-pg`) passed to the `PrismaClient` constructor. Two separate paths to the same
database — which matters when only one of them is misconfigured.

**Prisma no longer loads `.env` on its own.** `prisma.config.ts` imports `dotenv/config` explicitly.
Drop that import and every CLI command fails with an unresolved `DATABASE_URL`.

The generated client is ~10k lines of TypeScript, so it is gitignored and rebuilt by the root
`postinstall`. A fresh clone therefore needs `pnpm install` before it can typecheck.

## The SpanStore port

Spans are the only table with unbounded write volume, and the only one expected to outgrow
Postgres. Everything that reads or writes them goes through `SpanStore`:

```ts
interface SpanStore {
  insert(spans: SpanRecord[]): Promise<void>;
  byTrace(traceId: string): Promise<SpanRecord[]>;
  byTraces(traceIds: string[]): Promise<Map<string, SpanRecord[]>>;
}
```

`PostgresSpanStore` is the implementation for now. When span volume makes ClickHouse necessary, it
should mean writing `ClickHouseSpanStore` and flipping a flag — not touching the ingest path, the
worker, or the viewer. Please keep it that way: do not import the Prisma client to read or write
spans from anywhere else.

Inserts use `skipDuplicates` rather than upserts because spans are immutable once written, so an
existing row is already correct. That is what makes a redelivered OTLP batch harmless.
