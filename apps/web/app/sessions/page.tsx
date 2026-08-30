import Link from 'next/link';
import type { SessionListResponse } from '@syncline/protocol';

/**
 * The recordings list.
 *
 * A server component on purpose. The list endpoint requires the secret key — a browser-reachable
 * list would hand over every session id at once, and unguessable ids are currently the only thing
 * protecting a recording. The key is read from the server environment, used here, and never sent
 * to the browser.
 *
 * The page itself has no access control. Until real authentication exists, put the web app behind
 * whatever your deployment already uses.
 */

const API = process.env.SYNCLINE_API ?? 'http://localhost:4000';
const SECRET = process.env.SYNCLINE_SECRET_KEY;

export const dynamic = 'force-dynamic';

async function loadSessions(): Promise<
  SessionListResponse | { error: string }
> {
  if (!SECRET) {
    return {
      error:
        'SYNCLINE_SECRET_KEY is not set. Run `pnpm db:seed` and put the sk_ key it prints into your .env.',
    };
  }

  try {
    const res = await fetch(`${API}/v1/sessions?limit=50`, {
      headers: { 'x-syncline-key': SECRET },
      cache: 'no-store',
    });

    if (res.status === 401)
      return { error: 'SYNCLINE_SECRET_KEY was rejected by the API.' };
    if (!res.ok) return { error: `The API answered ${res.status}.` };

    return (await res.json()) as SessionListResponse;
  } catch {
    return { error: `Could not reach the API at ${API}. Is it running?` };
  }
}

export default async function SessionsPage() {
  const result = await loadSessions();

  if ('error' in result) {
    return (
      <main className="list">
        <Header count={null} />
        <p className="list__empty">{result.error}</p>
      </main>
    );
  }

  const { sessions } = result;

  return (
    <main className="list">
      <Header count={sessions.length} />

      {sessions.length === 0 ? (
        <p className="list__empty">
          No recordings yet. Point the browser SDK at this API and reload — the
          first chunk arrives within a few seconds of a page loading.
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

          {sessions.map((s) => (
            <Link key={s.id} href={`/s/${s.id}`} className="list__row">
              <span className="list__when">{formatWhen(s.startedMs)}</span>
              <span className="list__page">{shortPath(s.url)}</span>
              <span className="list__user">{s.userId ?? '—'}</span>
              <span className="num">{formatDuration(s.durationMs)}</span>
              <span className="num">{s.linkCount}</span>
              <span className={`num${s.errorCount > 0 ? ' list__errors' : ''}`}>
                {s.errorCount > 0 ? s.errorCount : '—'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function Header({ count }: { count: number | null }) {
  return (
    <div className="list__header">
      <Link href="/" className="wordmark">
        syncline
      </Link>
      <span className="eyebrow">
        {count === null
          ? 'recordings'
          : `${count} recording${count === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 19);
  return `${date} ${time}`;
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
