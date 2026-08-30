'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SetupStatus } from '../../../../../lib/setup-status';

/**
 * The diagnostic ladder.
 *
 * Four different failures all look like an empty recordings list, so each rung names the one thing
 * that has not happened yet and what to do about it.
 *
 * A rung only diagnoses when the rung below it has passed. Otherwise it is merely waiting, and
 * saying "recording works, but no requests were captured" while nothing has been recorded at all
 * would be three contradictory claims on one screen.
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

  // Polling stops once the pipeline is complete. There is nothing left to wait for, and a page
  // left open overnight should not keep asking.
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

  const steps = rungs(status);

  return (
    <section
      className={`panel progress${complete ? ' progress--complete' : ''}`}
    >
      <div className="progress__head">
        <h2 className="panel__title">
          {complete ? 'Everything is working' : 'Waiting for data'}
        </h2>
        {!complete && (
          <span className="progress__pulse">checking every 3s</span>
        )}
      </div>

      <ol className="progress__list">
        {steps.map((rung) => (
          <li
            key={rung.label}
            className={`progress__item${rung.done ? ' progress__item--done' : ''}${
              rung.blocked ? ' progress__item--blocked' : ''
            }`}
          >
            <span className="progress__mark">{rung.done ? '■' : '□'}</span>
            <div>
              <strong>{rung.label}</strong>
              <p className="progress__detail">{rung.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {status.latestRecordingId && (
        <p className="panel__note">
          Latest recording:{' '}
          <Link href={`/s/${status.latestRecordingId}`}>watch it</Link>
          {status.latestRecordingAt
            ? ` · ${new Date(status.latestRecordingAt).toISOString().slice(11, 19)} UTC`
            : ''}
        </p>
      )}
    </section>
  );
}
