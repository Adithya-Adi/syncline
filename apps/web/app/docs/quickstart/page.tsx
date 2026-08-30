import Link from 'next/link';

export const metadata = { title: 'Quickstart · Syncline' };

export default function Quickstart() {
  return (
    <>
      <h1 className="docs__h1">Quickstart</h1>
      <p className="docs__lede">
        Postgres, Redis and MinIO in Docker; three Node processes; an account
        and a project you create in the browser. About five minutes, most of it
        pulling images.
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
        The defaults match the Docker services. Two things to set yourself:
        <code>BETTER_AUTH_SECRET</code>, which signs session cookies, and
        nothing else — API keys are created in the app rather than in a file.
      </p>
      <pre className="snippet">
        <code>
          node -e
          &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64url&apos;))&quot;
        </code>
      </pre>
      <p>
        Note the ports: <strong>5442</strong> for Postgres and{' '}
        <strong>6399</strong> for Redis, not the standard ones. If you already
        run either natively, the standard port is taken, and on some systems a
        host connection will silently reach <em>your</em> server instead of the
        container with nothing to say so.
      </p>

      <h2 className="docs__h2">3. Start the infrastructure</h2>
      <pre className="snippet">
        <code>
          pnpm infra:up{'\n'}
          pnpm db:migrate
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
        <code>bucket &quot;syncline&quot; ready</code> at startup. If it does
        not, fix that before going further —{' '}
        <code>curl localhost:4000/v1/health</code> names the failing dependency.
      </p>

      <h2 className="docs__h2">5. Claim the instance</h2>
      <p>
        Open <code>http://localhost:3000/sign-up</code>. The first account
        becomes the owner and takes the default organization; sign-up closes
        afterwards, so an instance briefly exposed does not collect
        strangers&rsquo; accounts.
      </p>

      <h2 className="docs__h2">6. Create a project</h2>
      <p>
        A project owns a pair of API keys and the list of origins allowed to
        send recordings to it. Create one at <code>/projects/new</code>, listing
        the origins your app is served from.
      </p>
      <ul className="docs__list">
        <li>
          The <strong>public key</strong> (<code>pk_</code>) ships in your
          browser bundle. It is public by design — the origin allowlist is what
          protects it.
        </li>
        <li>
          The <strong>secret key</strong> (<code>sk_</code>) is shown once,
          because only its hash is stored. It is for your OpenTelemetry
          exporter. Lost it? Rotate.
        </li>
      </ul>

      <h2 className="docs__h2">7. Record something</h2>
      <p>
        The project page shows this snippet with your real key already in it.
        The <code>traceOrigins</code> list decides which requests get a{' '}
        <code>traceparent</code>; it defaults to the page&rsquo;s own origin.
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
        The page&rsquo;s origin has to be on the project&rsquo;s allowlist, or
        ingest answers <code>403</code> naming the origin it rejected.
      </p>

      <h2 className="docs__h2">8. Watch it arrive</h2>
      <p>
        Open <code>/sessions</code>. The first chunk lands within a few seconds
        of the page loading — the SDK flushes every five seconds or 64 KB,
        whichever comes first. Click a recording, then click a bar in any lane
        to zoom the timeline to that request.
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
            <td>Sign-up says the instance already has an owner</td>
            <td>
              Someone claimed it. Sign-up is first-run only; ask them for an
              invitation
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
