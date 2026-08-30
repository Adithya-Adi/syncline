import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { DataList, DataListHeader, DataListRow } from '@/components/data-list';
import { db } from '@/lib/db';
import { requireViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recordings · Syncline' };

/** Header and rows share this, so a column cannot drift from its heading. */
const COLUMNS = '180px minmax(0,1fr) 150px 110px 90px 90px 70px';

/**
 * Recordings for the viewer's organization.
 *
 * Read from Postgres rather than through the API. The API's list endpoint authenticates with a
 * project's secret key and we deliberately store only the hash, so the web app has no key to
 * present. Reading directly also keeps the tenant scope in one query instead of being implied by
 * whichever key happened to be configured.
 */
export default async function SessionsPage() {
  const viewer = await requireViewer();

  const sessions = await db.session.findMany({
    where: { project: { organizationId: viewer.organizationId } },
    orderBy: { startedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      startedAt: true,
      durationMs: true,
      url: true,
      userId: true,
      project: { select: { name: true } },
      _count: { select: { links: true } },
    },
  });

  // One grouped query for failure counts rather than one per row: fifty recordings should cost two
  // round trips, not fifty-one.
  const errors = await db.requestLink.groupBy({
    by: ['sessionId'],
    where: {
      sessionId: { in: sessions.map((s) => s.id) },
      status: { gte: 400 },
    },
    _count: { _all: true },
  });
  const errorBySession = new Map(
    errors.map((e) => [e.sessionId, e._count._all]),
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Recordings</h1>
        <p className="text-sm text-muted-foreground">
          {sessions.length} in {viewer.organizationName}
        </p>
      </div>

      {sessions.length === 0 ? (
        <p className="mt-10 max-w-prose text-sm leading-relaxed text-muted-foreground">
          No recordings yet. Add the browser SDK to a page using one of your{' '}
          <Link
            href="/projects"
            className="text-foreground underline underline-offset-4"
          >
            project keys
          </Link>{' '}
          — the first chunk arrives within a few seconds of the page loading.
        </p>
      ) : (
        <DataList columns={COLUMNS}>
          <DataListHeader columns={COLUMNS}>
            <span>Recorded</span>
            <span>Page</span>
            <span>Project</span>
            <span>User</span>
            <span className="text-right">Duration</span>
            <span className="text-right">Requests</span>
            <span className="text-right">Errors</span>
          </DataListHeader>

          {sessions.map((session) => {
            const errorCount = errorBySession.get(session.id) ?? 0;
            return (
              <DataListRow
                key={session.id}
                href={`/s/${session.id}`}
                columns={COLUMNS}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {formatWhen(session.startedAt)}
                </span>
                <span className="truncate font-mono text-xs">
                  {shortPath(session.url ?? undefined)}
                </span>
                <span className="truncate text-muted-foreground">
                  {session.project.name}
                </span>
                <span className="truncate text-muted-foreground">
                  {session.userId ?? '—'}
                </span>
                <span className="text-right font-mono text-xs tabular-nums">
                  {formatDuration(session.durationMs ?? 0)}
                </span>
                <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {session._count.links}
                </span>
                <span className="text-right">
                  {errorCount > 0 ? (
                    <Badge variant="destructive" className="tabular-nums">
                      {errorCount}
                    </Badge>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                      —
                    </span>
                  )}
                </span>
              </DataListRow>
            );
          })}
        </DataList>
      )}
    </main>
  );
}

function formatWhen(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function shortPath(url?: string): string {
  if (!url) return '—';
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}
