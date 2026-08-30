import Link from 'next/link';
import { db } from '../../../lib/db';
import { requireViewer } from '../../../lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recordings · Syncline' };

/**
 * Recordings for the viewer's organization.
 *
 * Read from Postgres rather than through the API. The API's list endpoint authenticates with a
 * project's secret key, and we deliberately store only the hash of those — so the web app could not
 * call it even if we wanted to. Reading directly is also what lets the query be scoped by
 * organization in one place instead of trusting a key to imply a tenant.
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
    <main className="list">
      <div className="list__header">
        <h1 className="list__h1">Recordings</h1>
        <span className="eyebrow">
          {sessions.length} in {viewer.organizationName}
        </span>
      </div>

      {sessions.length === 0 ? (
        <p className="list__empty">
          No recordings yet. Add the browser SDK to a page using one of your{' '}
          <Link href="/projects">project keys</Link> — the first chunk arrives
          within a few seconds of the page loading.
        </p>
      ) : (
        <div className="list__rows">
          <div className="list__head">
            <span>Recorded</span>
            <span>Page</span>
            <span>User</span>
            <span className="num">Duration</span>
            <span className="num">Requests</span>
            <span className="num">Errors</span>
          </div>

          {sessions.map((session) => {
            const errorCount = errorBySession.get(session.id) ?? 0;
            return (
              <Link
                key={session.id}
                href={`/s/${session.id}`}
                className="list__row"
              >
                <span className="list__when">
                  {formatWhen(session.startedAt)}
                </span>
                <span className="list__page">
                  {shortPath(session.url ?? undefined)}
                </span>
                <span className="list__user">{session.userId ?? '—'}</span>
                <span className="num">
                  {formatDuration(session.durationMs ?? 0)}
                </span>
                <span className="num">{session._count.links}</span>
                <span className={`num${errorCount > 0 ? ' list__errors' : ''}`}>
                  {errorCount > 0 ? errorCount : '—'}
                </span>
              </Link>
            );
          })}
        </div>
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
