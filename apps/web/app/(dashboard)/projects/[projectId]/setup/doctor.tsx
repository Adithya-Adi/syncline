'use client';

import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The connection doctor.
 *
 * Everything here runs in the integrator's browser on purpose. The failures this page exists to
 * name — a rejected origin, a preflight that drops `traceparent` — are properties of a browser
 * request, and a server-side probe would pass while the real site kept failing.
 *
 * Each check is phrased as the thing that is or is not true rather than as a status code, because
 * the point of the page is to save someone reading server logs.
 */

const INGEST_KEY_HEADER = 'x-syncline-key';

type Verdict = 'pass' | 'warn' | 'fail';

interface CheckResult {
  verdict: Verdict;
  label: string;
  detail: string;
}

function result(verdict: Verdict, label: string, detail: string): CheckResult {
  return { verdict, label, detail };
}

/**
 * Static problems in the origin allowlist.
 *
 * The guard compares the browser's `Origin` header to these entries exactly, so a trailing slash
 * or a path makes an entry unmatchable — a failure that looks, from the site, exactly like a bad
 * key. Cheaper to say so here than to let someone discover it as a 403.
 */
export function originProblems(origins: string[]): CheckResult[] {
  if (origins.length === 0) {
    return [
      result(
        'fail',
        'Origins allowlisted',
        'This project has no allowed origins, so browser ingest refuses every recording. Add them on the project page.',
      ),
    ];
  }

  const unmatchable: string[] = [];
  const insecure: string[] = [];

  for (const entry of origins) {
    if (entry === '*') {
      unmatchable.push(
        `${entry} (origins are matched exactly, so a wildcard never matches)`,
      );
      continue;
    }

    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      unmatchable.push(`${entry} (not a URL)`);
      continue;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      unmatchable.push(
        `${entry} (only http and https origins can send ingest)`,
      );
      continue;
    }

    // `new URL('https://a.example')` normalizes to a trailing slash, so the comparison is against
    // the origin a browser would actually send rather than against the raw string.
    if (entry !== url.origin) {
      unmatchable.push(
        `${entry} (a browser sends ${url.origin} — no path, no trailing slash)`,
      );
      continue;
    }

    if (
      url.protocol === 'http:' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1' &&
      url.hostname !== '[::1]'
    ) {
      insecure.push(entry);
    }
  }

  const checks: CheckResult[] = [
    unmatchable.length === 0
      ? result(
          'pass',
          'Origins allowlisted',
          `${origins.length} origin${origins.length === 1 ? '' : 's'} allowed, all in a form a browser will send.`,
        )
      : result(
          'fail',
          'Origins allowlisted',
          `These entries can never match an Origin header: ${unmatchable.join('; ')}.`,
        ),
  ];

  if (insecure.length > 0) {
    checks.push(
      result(
        'warn',
        'Origins served over HTTPS',
        `${insecure.join(', ')} is plaintext. Recordings from an insecure page travel in the clear, and the browser restricts storage and clipboard access there.`,
      ),
    );
  }

  return checks;
}

/** A syntactically valid W3C traceparent, which is all the preflight probe needs it to be. */
function sampleTraceparent(): string {
  const hex = (bytes: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  return `00-${hex(16)}-${hex(8)}-01`;
}

async function checkApi(endpoint: string): Promise<CheckResult[]> {
  let response: Response;
  try {
    response = await fetch(`${endpoint}/v1/health`, { cache: 'no-store' });
  } catch {
    return [
      result(
        'fail',
        'Syncline API reachable',
        `The browser could not reach ${endpoint}. Either it is not running, or it did not allow this origin.`,
      ),
    ];
  }

  // Health answers 503 with the same report when a dependency is down, so the body is worth
  // reading either way — "which dependency" is the whole point of the endpoint.
  const report = (await response.json().catch(() => null)) as {
    status?: string;
    checks?: Record<string, { ok?: boolean; error?: string }>;
  } | null;

  const checks: CheckResult[] = [
    result('pass', 'Syncline API reachable', `${endpoint} answered.`),
  ];

  for (const [name, check] of Object.entries(report?.checks ?? {})) {
    checks.push(
      result(
        check.ok === true ? 'pass' : 'fail',
        `Ingest dependency: ${name}`,
        check.ok === true
          ? 'Healthy.'
          : (check.error ??
              'Not healthy — chunks will be accepted and then lost before processing.'),
      ),
    );
  }

  if (!report?.checks) {
    checks.push(
      result(
        response.ok ? 'pass' : 'fail',
        'Ingest dependencies healthy',
        response.ok
          ? 'The API reported no dependency problems.'
          : `Health returned HTTP ${response.status} without a report.`,
      ),
    );
  }

  return checks;
}

async function checkClock(endpoint: string): Promise<CheckResult> {
  try {
    const sentAt = Date.now();
    const response = await fetch(`${endpoint}/v1/clock`, { cache: 'no-store' });
    const roundTrip = Date.now() - sentAt;
    const body = (await response.json().catch(() => null)) as {
      serverMs?: number;
    } | null;

    if (!response.ok || typeof body?.serverMs !== 'number') {
      return result(
        'fail',
        'Clock calibration available',
        `The clock endpoint returned HTTP ${response.status}. Without it, replay timestamps and span timestamps drift apart by however wrong this machine's clock is.`,
      );
    }

    // The SDK's own estimate, run once here: server time at the midpoint of the round trip.
    const drift = Math.abs(
      Math.round(body.serverMs - (sentAt + roundTrip / 2)),
    );

    return result(
      drift > 2000 ? 'warn' : 'pass',
      'Clock calibration available',
      drift > 2000
        ? `This machine's clock is ${(drift / 1000).toFixed(1)}s from the API's (round trip ${roundTrip}ms). The SDK corrects for it, but a skew this large usually means an unsynchronized host.`
        : `Offset ${drift}ms, round trip ${roundTrip}ms.`,
    );
  } catch {
    return result(
      'fail',
      'Clock calibration available',
      'The clock endpoint could not be reached from this browser.',
    );
  }
}

/**
 * Distinguishes the two failures that look identical from inside a page: a key the API does not
 * know, and a key it knows perfectly well but will not spend for this origin.
 *
 * A 403 here is a pass. This page is served from the dashboard, which is not one of the project's
 * allowlisted origins and should not be — but the API only rejects an origin *after* the key has
 * resolved to a project, so the rejection itself proves the key is live.
 */
async function checkKey(
  endpoint: string,
  publicKey: string,
  origins: string[],
): Promise<CheckResult> {
  let response: Response;
  try {
    response = await fetch(`${endpoint}/v1/projects/me`, {
      cache: 'no-store',
      headers: { [INGEST_KEY_HEADER]: publicKey },
    });
  } catch {
    return result(
      'fail',
      'Public key accepted',
      `The request carrying ${INGEST_KEY_HEADER} never got a response. If the API is reachable above, it is up but dropping that header in its preflight.`,
    );
  }

  if (response.ok) {
    const body = (await response.json().catch(() => null)) as {
      name?: string;
    } | null;
    return result(
      'pass',
      'Public key accepted',
      `The API resolved the key to ${body?.name ?? 'this project'}, and allowed this origin as well.`,
    );
  }

  if (response.status === 403) {
    return result(
      'pass',
      'Public key accepted',
      `The key resolved to a project. The API then refused this page's origin, which is expected — the dashboard is not an allowlisted origin. ${
        origins.length > 0
          ? `Ingest will be allowed from ${origins.join(', ')}.`
          : 'This project has no allowed origins yet, so no site can use the key.'
      }`,
    );
  }

  if (response.status === 401) {
    return result(
      'fail',
      'Public key accepted',
      'The API does not recognize this key. It is most likely from a different Syncline deployment, or it was rotated after this page loaded.',
    );
  }

  return result(
    'fail',
    'Public key accepted',
    `The key check returned an unexpected HTTP ${response.status}.`,
  );
}

/**
 * The one failure that gets blamed on Syncline.
 *
 * A traced request carries `traceparent`, which makes it non-simple, which means the integrator's
 * own API has to name that header in `Access-Control-Allow-Headers`. When it does not, every traced
 * request fails preflight and the site appears to break the moment recording is switched on.
 *
 * The control request is what makes the answer trustworthy: without it, an API that is simply down
 * is indistinguishable from one that rejects the header.
 */
async function checkTraceparent(rawUrl: string): Promise<CheckResult[]> {
  let target: string;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('not http');
    }
    target = url.toString();
  } catch {
    return [
      result(
        'fail',
        'traceparent survives preflight',
        'Enter an http or https URL your app actually calls, for example https://api.example.com/health.',
      ),
    ];
  }

  try {
    await fetch(target, { mode: 'cors', cache: 'no-store' });
  } catch {
    return [
      result(
        'warn',
        'traceparent survives preflight',
        `${target} could not be reached from this page even without the header, so the header itself cannot be tested from here. This dashboard's origin is probably not in that API's CORS allowlist — run the same request from your own app, or allow this origin temporarily.`,
      ),
    ];
  }

  try {
    await fetch(target, {
      mode: 'cors',
      cache: 'no-store',
      headers: { traceparent: sampleTraceparent() },
    });
  } catch {
    return [
      result(
        'fail',
        'traceparent survives preflight',
        `${target} answers a plain request but rejects one carrying traceparent. Add "traceparent" to Access-Control-Allow-Headers on that API — until you do, every traced request from the browser will fail.`,
      ),
    ];
  }

  return [
    result(
      'pass',
      'traceparent survives preflight',
      `${target} accepts a request carrying traceparent, so traced requests reach it with a trace id your backend can export against.`,
    ),
  ];
}

const ICONS: Record<Verdict, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: TriangleAlert,
  fail: CircleAlert,
};

const ICON_TONE: Record<Verdict, string> = {
  pass: 'text-primary',
  warn: 'text-network',
  fail: 'text-destructive',
};

function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="space-y-3">
      {checks.map((check) => {
        const Icon = ICONS[check.verdict];
        return (
          <li key={check.label} className="flex gap-2.5">
            <Icon
              className={`mt-0.5 size-4 shrink-0 ${ICON_TONE[check.verdict]}`}
            />
            <div className="min-w-0">
              <p className="text-sm">{check.label}</p>
              <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                {check.detail}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SetupDoctor({
  endpoint,
  publicKey,
  origins,
}: {
  endpoint: string;
  publicKey: string;
  origins: string[];
}) {
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);

  const [apiUrl, setApiUrl] = useState('');
  const [corsChecks, setCorsChecks] = useState<CheckResult[]>([]);
  const [probing, setProbing] = useState(false);

  async function runChecks() {
    setRunning(true);
    try {
      const [api, clock, key] = await Promise.all([
        checkApi(endpoint),
        checkClock(endpoint),
        checkKey(endpoint, publicKey, origins),
      ]);
      setChecks([...api, clock, key, ...originProblems(origins)]);
    } finally {
      setRunning(false);
    }
  }

  async function runProbe() {
    setProbing(true);
    try {
      setCorsChecks(await checkTraceparent(apiUrl.trim()));
    } finally {
      setProbing(false);
    }
  }

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Check the connection</CardTitle>
          <CardDescription>
            Runs in this browser, against this project&rsquo;s real key.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={runChecks}
              disabled={running}
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {running ? 'Checking' : 'Test connection'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {checks.length === 0 ? (
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              Confirms the API is up, its dependencies are healthy, the clock
              endpoint answers, this key resolves to this project, and the
              allowlisted origins are in a form a browser will actually send.
            </p>
          ) : (
            <CheckList checks={checks} />
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Check your own API&rsquo;s CORS</CardTitle>
          <CardDescription>
            The failure that gets blamed on Syncline: an API that rejects the{' '}
            <code className="font-mono">traceparent</code> header the SDK adds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runProbe();
            }}
          >
            <Input
              type="url"
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
              placeholder="https://api.example.com/health"
              aria-label="A URL your app calls"
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={probing || apiUrl.trim().length === 0}
            >
              {probing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {probing ? 'Probing' : 'Probe'}
            </Button>
          </form>

          {corsChecks.length === 0 ? (
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              Sends two requests to a URL your app calls — one plain, one
              carrying <code className="font-mono">traceparent</code> — and
              reports which one your API refuses. Nothing is stored.
            </p>
          ) : (
            <CheckList checks={corsChecks} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
