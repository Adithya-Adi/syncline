import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Clapperboard,
  Clock,
  Network,
} from 'lucide-react';

import { DataList, DataListHeader, DataListRow } from '@/components/data-list';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import type { Viewer } from '@/lib/session';

const COLUMNS = '178px minmax(240px,1.6fr) 140px 96px 96px 86px 86px';
const LIST_MIN_WIDTH = '980px';

const countFormat = new Intl.NumberFormat('en-US');
const timeFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const timeWithYearFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export async function RecordingsSurface({
  viewer,
  project,
  showAll = false,
}: {
  viewer: Viewer;
  project: { id: string; name: string };
  /** Include recordings marked trivial — short, and with nothing in them. */
  showAll?: boolean;
}) {
  const sessions = await db.session.findMany({
    where: {
      project: {
        organizationId: viewer.organizationId,
        id: project.id,
      },
      // Recordings with nothing in them are hidden rather than deleted, so a direct link to one
      // still works and the "show empty" toggle brings them back.
      ...(showAll ? {} : { trivial: false }),
    },
    orderBy: { startedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      startedAt: true,
      durationMs: true,
      url: true,
      userId: true,
      trivial: true,
      // Counted by the worker as chunks land, so the list does not pay a query per row for the
      // one number that decides whether a recording is worth opening.
      errorCount: true,
      consoleErrorCount: true,
      _count: { select: { links: true, pageviews: true } },
      // The flow, trimmed to what a row can show: where they came in, and the first few steps.
      pageviews: {
        orderBy: { ordinal: 'asc' },
        take: 4,
        select: { ordinal: true, path: true },
      },
    },
  });

  // Failed requests are a predicate over a second table rather than a number the ingest path
  // already knew, so unlike the error counts they still cost a query — one grouped query for the
  // whole page, not one per row.
  const failures =
    sessions.length > 0
      ? await db.requestLink.groupBy({
          by: ['sessionId'],
          where: {
            sessionId: { in: sessions.map((session) => session.id) },
            status: { gte: 400 },
          },
          _count: { _all: true },
        })
      : [];
  const failedBySession = new Map(
    failures.map((failure) => [failure.sessionId, failure._count._all]),
  );
  const rows = sessions.map((session) => ({
    session,
    failedRequestCount: failedBySession.get(session.id) ?? 0,
  }));

  const totalRequests = sessions.reduce(
    (total, session) => total + session._count.links,
    0,
  );
  const completedDurations = sessions
    .map((session) => session.durationMs)
    .filter((duration): duration is number => typeof duration === 'number');
  const averageDuration =
    completedDurations.length > 0
      ? Math.round(
          completedDurations.reduce((total, duration) => total + duration, 0) /
            completedDurations.length,
        )
      : null;
  const totalFailedRequests = rows.reduce(
    (total, row) => total + row.failedRequestCount,
    0,
  );
  const totalErrors = sessions.reduce(
    (total, session) => total + session.errorCount,
    0,
  );
  // Either kind counts as broken. Which kind it was decides who reads the recording, so the tile
  // shows both numbers rather than one sum of two unlike things.
  const brokenRecordings = rows.filter(
    (row) => row.failedRequestCount > 0 || row.session.errorCount > 0,
  ).length;
  const latest = sessions[0]?.startedAt;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-7 px-5 py-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Project recordings"
        title={project.name}
        description={
          <>
            Recordings captured by{' '}
            <span className="font-medium text-foreground">{project.name}</span>.
            Newest first.
          </>
        }
        actions={
          <>
            {/*
             * A link rather than a checkbox, so the state lives in the URL and can be shared. The
             * hidden recordings are the ones with nothing in them — never one that failed.
             */}
            <Button asChild variant="ghost" size="sm">
              <Link
                href={
                  showAll
                    ? `/projects/${project.id}/recordings`
                    : `/projects/${project.id}/recordings?all=1`
                }
              >
                {showAll ? 'Hide empty' : 'Show empty'}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${project.id}`}>Settings</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/projects/${project.id}/setup`}>Set up SDK</Link>
            </Button>
          </>
        }
      />

      {sessions.length === 0 ? (
        <EmptyState
          icon={<Clapperboard className="size-4" />}
          title="No recordings for this project"
          action={
            <Button asChild size="sm">
              <Link href={`/projects/${project.id}/setup`}>
                Set up this project
              </Link>
            </Button>
          }
        >
          Add the browser SDK to a page using one of your project keys. The
          first chunk arrives within a few seconds of the page loading.
        </EmptyState>
      ) : (
        <>
          <section className="grid gap-px overflow-hidden rounded-lg border border-border/80 bg-border/70 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              icon={<Clapperboard className="size-3.5" />}
              label="Recordings"
              value={formatCount(sessions.length)}
              detail="In this project"
            />
            <Metric
              icon={<Network className="size-3.5" />}
              label="Requests"
              value={formatCount(totalRequests)}
              detail="Linked requests in view"
            />
            <Metric
              icon={<Activity className="size-3.5" />}
              label="Avg duration"
              value={
                averageDuration === null ? '-' : formatDuration(averageDuration)
              }
              detail={
                completedDurations.length > 0
                  ? 'Completed recordings'
                  : 'No completed durations'
              }
            />
            <Metric
              icon={<AlertTriangle className="size-3.5" />}
              label="Failures"
              value={formatCount(brokenRecordings)}
              detail={`${formatCount(totalErrors)} ${plural(
                totalErrors,
                'error',
              )} · ${formatCount(totalFailedRequests)} failed ${plural(
                totalFailedRequests,
                'request',
              )}`}
              tone={brokenRecordings > 0 ? 'fault' : 'default'}
            />
          </section>

          <section className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold">
                  Project recordings
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open a recording to inspect replay, timing, and linked backend
                  requests.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="size-3.5" />
                <span>{latest ? formatRecency(latest) : 'No captures'}</span>
              </div>
            </div>

            <DataList
              columns={COLUMNS}
              minWidth={LIST_MIN_WIDTH}
              className="mt-4"
            >
              <DataListHeader columns={COLUMNS}>
                <span>Recorded</span>
                <span>Flow</span>
                <span>User</span>
                <span className="text-right">Duration</span>
                <span className="text-right">Requests</span>
                <span className="text-right">Failed</span>
                <span className="text-right">Errors</span>
              </DataListHeader>

              {rows.map(({ session, failedRequestCount }) => {
                const page = pageParts(session.url ?? undefined);

                return (
                  <DataListRow
                    key={session.id}
                    href={`/s/${session.id}`}
                    columns={COLUMNS}
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-xs text-foreground">
                        {formatWhen(session.startedAt)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {formatRecency(session.startedAt)}
                      </span>
                    </span>
                    {/*
                     * The flow rather than the landing URL. Which pages a session went through is
                     * the thing that tells you whether it is worth opening; the host it happened on
                     * is the same for every row in a project.
                     */}
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[13px] text-foreground">
                        {session.pageviews.length > 0
                          ? session.pageviews
                              .map((view) => view.path)
                              .join(' → ')
                          : page.path}
                        {session._count.pageviews >
                          session.pageviews.length && (
                          <span className="text-muted-foreground">
                            {' '}
                            → +
                            {session._count.pageviews -
                              session.pageviews.length}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {session._count.pageviews > 0
                          ? `${formatCount(session._count.pageviews)} ${plural(
                              session._count.pageviews,
                              'page',
                            )} · ${page.host}`
                          : page.host}
                      </span>
                    </span>
                    <span className="truncate text-muted-foreground">
                      {session.userId ?? 'No user id'}
                    </span>
                    <span className="text-right font-mono text-xs tabular-nums">
                      {formatDuration(session.durationMs)}
                    </span>
                    <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {formatCount(session._count.links)}
                    </span>
                    {/*
                     * Two columns rather than one sum. A 500 is the backend's failure and a
                     * TypeError is the frontend's; a row showing "2" for one of each would send
                     * whoever opens it looking in the wrong place first.
                     */}
                    <span className="text-right">
                      <FaultCount value={failedRequestCount} />
                    </span>
                    <span className="text-right">
                      <FaultCount
                        value={session.errorCount}
                        title={
                          session.consoleErrorCount > 0
                            ? `${formatCount(
                                session.consoleErrorCount,
                              )} console ${plural(
                                session.consoleErrorCount,
                                'error',
                              )} as well`
                            : undefined
                        }
                      />
                    </span>
                  </DataListRow>
                );
              })}
            </DataList>
          </section>
        </>
      )}
    </main>
  );
}

/**
 * A count that only shouts when it is not zero.
 *
 * A destructive badge on every row would make the column unreadable at a glance, which is the only
 * thing the column is for.
 */
function FaultCount({ value, title }: { value: number; title?: string }) {
  if (value === 0) {
    return (
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        0
      </span>
    );
  }

  return (
    <Badge
      variant="destructive"
      className="font-mono tabular-nums"
      {...(title ? { title } : {})}
    >
      {formatCount(value)}
    </Badge>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'fault';
}) {
  return (
    <div className="min-w-0 bg-background px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={
            tone === 'fault' ? 'text-destructive' : 'text-muted-foreground'
          }
        >
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <div className="mt-2 truncate font-display text-2xl font-semibold tabular-nums">
        {value}
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

function formatCount(value: number): string {
  return countFormat.format(value);
}

function formatWhen(date: Date): string {
  if (!hasReliableStart(date)) return 'No browser clock';

  const now = new Date();
  const formatter =
    date.getFullYear() === now.getFullYear() ? timeFormat : timeWithYearFormat;

  return formatter.format(date);
}

function formatRecency(date: Date): string {
  if (!hasReliableStart(date)) return 'Start time missing';

  const ageMs = Date.now() - date.getTime();
  if (ageMs < 0) return 'Clock ahead';
  if (ageMs < 60_000) return 'Just now';
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 24 * 60 * 60_000) {
    return `${Math.floor(ageMs / (60 * 60_000))}h ago`;
  }
  if (ageMs < 30 * 24 * 60 * 60_000) {
    return `${Math.floor(ageMs / (24 * 60 * 60_000))}d ago`;
  }

  return 'Older than 30d';
}

function formatDuration(ms?: number | null): string {
  if (ms === null || ms === undefined) return 'Live';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function pageParts(url?: string): { path: string; host: string } {
  if (!url) return { path: 'Unknown page', host: 'No URL captured' };

  try {
    const parsed = new URL(url);
    return {
      path: parsed.pathname + parsed.search || '/',
      host: parsed.host,
    };
  } catch {
    return { path: url, host: 'Captured URL' };
  }
}

function hasReliableStart(date: Date): boolean {
  return date.getUTCFullYear() > 1971;
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
