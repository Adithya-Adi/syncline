import Link from 'next/link';

export const metadata = { title: 'Quickstart · Syncline' };

export default function Quickstart() {
  return (
    <>
      <h1 className="docs__h1">Quickstart</h1>
      <p className="docs__lede">
        Postgres, Redis and MinIO in Docker; three Node processes; one seeded
        project. About five minutes, most of it pulling images.
      </p>

      <h2 className="docs__h2">1. Clone and install</h2>
      <pre className="snippet">
        <code>
          git clone https://github.com/Adithya-Adi/syncline{'\n'}
          cd syncline{'\n'}
          pnpm install
        </code>
      </pre>
      <p>
        The install runs <code>prisma generate</code>, which needs no database.
        Node 22 or newer, and pnpm — the version is pinned in{' '}
        <code>package.json</code>.
      </p>

      <h2 className="docs__h2">2. Configure</h2>
      <pre className="snippet">
        <code>cp .env.example .env</code>
      </pre>
      <p>
        The defaults match the Docker services. Note the ports:{' '}
        <strong>5442</strong> for Postgres and <strong>6399</strong> for Redis,
        not the standard ones. If you already run either natively, the standard
        port is taken, and on some systems a host connection will silently reach{' '}
        <em>your</em> server instead of the container with nothing to say so.
      </p>

      <h2 className="docs__h2">3. Start the infrastructure</h2>
      <pre className="snippet">
        <code>
          pnpm infra:up{'\n'}
          pnpm db:migrate{'\n'}
          pnpm db:seed
        </code>
      </pre>
      <p>
        The seed prints a public key and a secret key. The secret is shown once
        and never again — only its hash is stored — so copy both into{' '}
        <code>.env</code> now:
      </p>
      <pre className="snippet">
        <code>
          <span className="k">SYNCLINE_SECRET_KEY</span>=
          <span className="s">sk_...</span>
          {'\n'}
          <span className="k">NEXT_PUBLIC_SYNCLINE_API</span>=
          <span className="s">http://localhost:4000</span>
        </code>
      </pre>

      <h2 className="docs__h2">4. Run it</h2>
      <p>Three processes, three terminals:</p>
      <pre className="snippet">
        <code>
          <span className="c"># terminal 1 — ingest and read API on :4000</span>
          {'\n'}
          pnpm nx build api && node apps/api/dist/main.js{'\n\n'}
          <span className="c"># terminal 2 — queue consumers</span>
          {'\n'}
          pnpm nx build worker && node apps/worker/dist/main.js{'\n\n'}
          <span className="c"># terminal 3 — the web app on :3000</span>
          {'\n'}
          pnpm nx dev web
        </code>
      </pre>
      <p>
        The API logs <code>database connected</code> and{' '}
        <code>bucket &quot;syncline&quot; ready</code>
        at startup. If it does not, that is the thing to fix before going
        further — <code>curl localhost:4000/v1/health</code> names the failing
        dependency.
      </p>

      <h2 className="docs__h2">5. Record something</h2>
      <p>
        Add the SDK to a page you control. The <code>traceOrigins</code> list
        decides which requests get a <code>traceparent</code> — it defaults to
        the page&rsquo;s own origin.
      </p>
      <pre className="snippet">
        <code>
          <span className="k">import</span> {'{ startRecording }'}{' '}
          <span className="k">from</span>{' '}
          <span className="s">&apos;@syncline/browser&apos;</span>;{'\n\n'}
          startRecording({'{'}
          {'\n  '}key: <span className="s">&apos;pk_...&apos;</span>,{'\n  '}
          endpoint: <span className="s">&apos;http://localhost:4000&apos;</span>
          ,{'\n  '}traceOrigins: [
          <span className="s">&apos;http://localhost:3000&apos;</span>],{'\n'}
          {'}'});
        </code>
      </pre>
      <p>
        The project&rsquo;s origin allowlist has to include the page&rsquo;s
        origin, or ingest answers <code>403</code> naming the origin it
        rejected. The seed allows <code>http://localhost:3000</code> and{' '}
        <code>http://localhost:4200</code>.
      </p>

      <h2 className="docs__h2">6. Watch it arrive</h2>
      <p>
        Open <code>http://localhost:3000/sessions</code>. The first chunk lands
        within a few seconds of the page loading — the SDK flushes every five
        seconds or 64 KB, whichever comes first. Click a recording, then click a
        bar in any lane to zoom the timeline to that request.
      </p>

      <div className="callout">
        No backend traces yet? That is expected until your services export OTLP.{' '}
        <Link href="/docs/backend">Backend tracing</Link> is two environment
        variables and one CORS header.
      </div>

      <h2 className="docs__h2">Troubleshooting</h2>
      <table className="docs__table">
        <thead>
          <tr>
            <th>Symptom</th>
            <th>Cause</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Ingest returns 403</td>
            <td>The page origin is not on the project&rsquo;s allowlist</td>
          </tr>
          <tr>
            <td>Ingest returns 401</td>
            <td>
              Wrong key kind — recordings need <code>pk_</code>, OTLP needs{' '}
              <code>sk_</code>
            </td>
          </tr>
          <tr>
            <td>Recordings list is empty but ingest returned 202</td>
            <td>The worker is not running; the queue has the job waiting</td>
          </tr>
          <tr>
            <td>Requests fail after adding the SDK</td>
            <td>
              Your API must allow the <code>traceparent</code> header in{' '}
              <code>Access-Control-Allow-Headers</code>
            </td>
          </tr>
          <tr>
            <td>Backend lane stays empty</td>
            <td>
              Traces are arriving on a different trace id, or not arriving at
              all
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
