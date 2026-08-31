'use client';

import { CircleCheck, Circle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { SetupStatus } from '@/lib/setup-status';

/**
 * The diagnostic ladder.
 *
 * Four different failures all look like an empty recordings list, so each rung names the one thing
 * that has not happened yet and what to do about it.
 *
 * A rung only diagnoses when the rung below it has passed. Otherwise it is merely waiting — saying
 * "recording works, but no requests were captured" while nothing has been recorded at all would put
 * three contradictory claims on one screen.
 */

const POLL_MS = 3000;

interface Rung {
  done: boolean;
  blocked: boolean;
  label: string;
  detail: string;
}

function plural(
  count: number,
  singular: string,
  verb: [string, string],
): string {
  return `${count} ${singular}${count === 1 ? '' : 's'} ${count === 1 ? verb[0] : verb[1]}`;
}

function rungs(status: SetupStatus): Rung[] {
  const recorded = status.recordings > 0;
  const traced = status.requests > 0;

  return [
    {
      done: recorded,
      blocked: false,
      label: 'Recordings arriving',
      detail: recorded
        ? plural(status.recordings, 'recording', ['received', 'received']) + '.'
        : 'Nothing yet. Load a page with the snippet on it — the first chunk is sent within about five seconds. If ingest is refusing the key you will see a 403 in the browser network tab, naming the origin it rejected.',
    },
    {
      done: traced,
      blocked: !recorded,
      label: 'Requests captured',
      detail: !recorded
        ? 'Waiting for the first recording.'
        : traced
          ? plural(status.requests, 'request', ['recorded', 'recorded']) +
            ' with trace ids.'
          : 'Recording works, but no requests were captured. Either the page made none while recording, or none went to an origin in traceOrigins — the SDK deliberately never touches requests to anyone else.',
    },
    {
      done: status.stitched > 0,
      blocked: !traced,
      label: 'Backend spans stitched',
      detail: !traced
        ? 'Waiting for a traced request.'
        : status.stitched > 0
          ? plural(status.stitched, 'request', ['resolves', 'resolve']) +
            ' to backend spans.'
          : 'Requests are being traced, but no spans have arrived on those trace ids. Either your services are not exporting OTLP to Syncline yet, or the traceparent header is not reaching them — which is usually the CORS header below.',
    },
  ];
}

export function SetupProgress({
  projectId,
  initial,
}: {
  projectId: string;
  initial: SetupStatus;
}) {
  const [status, setStatus] = useState(initial);

  // Polling stops once the pipeline is complete. There is nothing left to wait for, and a page left
  // open overnight should not keep asking.
  const complete = status.step === 'complete';

  useEffect(() => {
    if (complete) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/status`, {
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        setStatus((await res.json()) as SetupStatus);
      } catch {
        // A failed poll is not worth surfacing; the next one is three seconds away.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, complete]);

  return (
    <Card className={cn('mt-6', complete && 'border-primary/40')}>
      <CardHeader>
        <CardTitle>
          {complete ? 'Everything is working' : 'Waiting for data'}
        </CardTitle>
        {!complete && (
          <CardAction>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              checking every 3s
            </span>
          </CardAction>
        )}
      </CardHeader>

      <CardContent>
        <ol className="relative space-y-4">
          {/*
           * A rail behind the marks, so three rungs read as one ladder rather than three unrelated
           * checks. It stops short at both ends to avoid poking out past the first and last mark.
           */}
          <span
            aria-hidden="true"
            className="absolute top-4 bottom-4 left-[7px] w-px bg-border"
          />
          {rungs(status).map((rung) => (
            <li key={rung.label} className="relative flex gap-3">
              {rung.done ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 bg-card text-primary" />
              ) : (
                <span className="relative mt-0.5 size-4 shrink-0 bg-card">
                  <Circle
                    className={cn(
                      'size-4',
                      rung.blocked
                        ? 'text-muted-foreground/40'
                        : 'text-muted-foreground',
                    )}
                  />
                  {/* The one rung actually being waited on says so without another spinner. */}
                  {!rung.blocked && (
                    <span className="bg-network absolute inset-1 animate-ping rounded-full opacity-60" />
                  )}
                </span>
              )}
              <div className="space-y-1">
                <p
                  className={cn(
                    'text-sm',
                    !rung.done && 'text-muted-foreground',
                  )}
                >
                  {rung.label}
                </p>
                <p
                  className={cn(
                    'max-w-prose text-xs leading-relaxed',
                    rung.blocked
                      ? 'text-muted-foreground/60'
                      : 'text-muted-foreground',
                  )}
                >
                  {rung.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {status.latestRecordingId && (
          <p className="mt-5 text-xs text-muted-foreground">
            Latest recording:{' '}
            <Link
              href={`/s/${status.latestRecordingId}`}
              className="text-foreground underline underline-offset-4"
            >
              watch it
            </Link>
            {status.latestRecordingAt
              ? ` · ${new Date(status.latestRecordingAt).toISOString().slice(11, 19)} UTC`
              : ''}
          </p>
        )}

        {/*
         * Evidence, not a count. Counts are a claim someone has to take on trust; a real URL with a
         * real trace id is how they confirm the traffic on this page is their own — and the trace
         * id is what they paste into their own tracing tool when Syncline shows no spans for it.
         */}
        {status.latestRequest && (
          <dl className="mt-4 space-y-1.5 border-t pt-4 text-xs">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Request</dt>
              <dd className="min-w-0 truncate font-mono">
                {status.latestRequest.method} {status.latestRequest.url}
                {status.latestRequest.status
                  ? ` → ${status.latestRequest.status}`
                  : ''}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Trace</dt>
              <dd className="min-w-0 truncate font-mono">
                {status.latestRequest.traceId}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Spans</dt>
              <dd className="min-w-0 text-muted-foreground">
                {status.latestRequest.stitched ? (
                  <Link
                    href={`/s/${status.latestRequest.sessionId}`}
                    className="text-foreground underline underline-offset-4"
                  >
                    stitched — open the replay
                  </Link>
                ) : (
                  'none on this trace id yet'
                )}
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
