export const metadata = { title: 'Self-hosting' };

export default function SelfHosting() {
  return (
    <>
      <h1 className="docs__h1">Self-hosting</h1>
      <p className="docs__lede">
        Three Node processes and three pieces of infrastructure. Each scales
        independently, and the ingest path is deliberately the cheapest thing in
        the system.
      </p>

      <h2 className="docs__h2">What you need</h2>
      <table className="docs__table">
        <thead>
          <tr>
            <th>Dependency</th>
            <th>Used for</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>PostgreSQL 15+</td>
            <td>Sessions, chunk index, request links, spans</td>
            <td>The index, never the recordings themselves</td>
          </tr>
          <tr>
            <td>Redis 7+</td>
            <td>BullMQ queues</td>
            <td>
              Must run with <code>maxmemory-policy noeviction</code>
            </td>
          </tr>
          <tr>
            <td>S3-compatible storage</td>
            <td>rrweb chunks and raw OTLP bodies</td>
            <td>MinIO, S3, R2 — anything with the API</td>
          </tr>
        </tbody>
      </table>

      <h2 className="docs__h2">The processes</h2>
      <ul className="docs__list">
        <li>
          <strong>api</strong> — authenticates, stores the raw body, enqueues,
          returns 202. It parses nothing, so it stays cheap under load and never
          inflates hostile gzip on an HTTP connection. Stateless; scale
          horizontally.
        </li>
        <li>
          <strong>worker</strong> — decompresses, validates, normalizes OTLP,
          writes rows. The expensive work lives here. Scale by process count or
          with <code>WORKER_CONCURRENCY</code>.
        </li>
        <li>
          <strong>web</strong> — the recordings list and the viewer. Holds the
          secret key server-side; the browser never receives it.
        </li>
      </ul>

      <h2 className="docs__h2">Configuration</h2>
      <pre className="snippet">
        <code>
          <span className="k">DATABASE_URL</span>=
          <span className="s">postgresql://…</span>
          {'\n'}
          <span className="k">REDIS_URL</span>=
          <span className="s">redis://…</span>
          {'\n'}
          <span className="k">S3_ENDPOINT</span>=
          <span className="s">https://…</span>
          {'\n'}
          <span className="k">S3_BUCKET</span>=
          <span className="s">syncline</span>
          {'\n'}
          <span className="k">S3_ACCESS_KEY_ID</span>=
          <span className="s">…</span>
          {'\n'}
          <span className="k">S3_SECRET_ACCESS_KEY</span>=
          <span className="s">…</span>
          {'\n'}
          <span className="k">S3_FORCE_PATH_STYLE</span>=
          <span className="s">true</span>
          {'   '}
          <span className="c"># MinIO yes, most clouds no</span>
          {'\n'}
          <span className="k">API_PORT</span>=<span className="s">4000</span>
          {'\n'}
          <span className="k">WORKER_CONCURRENCY</span>=
          <span className="s">4</span>
        </code>
      </pre>
      <p>
        Every variable is validated at startup. A missing one stops the process
        with a message naming it, rather than surfacing as a connection error on
        the first ingest an hour later.
      </p>

      <h2 className="docs__h2">Sizing</h2>
      <p>
        rrweb chunks dominate storage — expect a few hundred KB per minute of an
        active session, compressed. Postgres holds only the index: rows per
        chunk, per request and per span, which stays small until span volume
        grows. Spans are written through a <code>SpanStore</code> port precisely
        so that a move to ClickHouse is a new implementation and a config flag
        rather than a rewrite.
      </p>

      <h2 className="docs__h2">Operating notes</h2>
      <ul className="docs__list">
        <li>
          <code>GET /v1/health</code> returns 503 and names the failing
          dependency. Point your load balancer at it.
        </li>
        <li>
          Ingest stores the body <em>before</em> enqueuing, so a Redis outage
          loses an upload the client already paid for. Health checks Redis for
          exactly that reason.
        </li>
        <li>
          Jobs are idempotent. Retries and redeliveries upsert; a body that will
          never be valid fails once instead of three times.
        </li>
        <li>
          Chunks are immutable once written, and served with a long cache
          lifetime.
        </li>
        <li>
          Ports 5442 and 6399 in the bundled compose file are deliberate: a
          machine already running Postgres or Redis owns the standard ports, and
          a host connection can silently reach the wrong server.
        </li>
      </ul>

      <h2 className="docs__h2">Running it</h2>
      <p>
        One <code>Dockerfile</code> with three targets — <code>api</code>,{' '}
        <code>worker</code>, <code>web</code> — plus a <code>migrate</code>{' '}
        target that runs to completion before any of them start.{' '}
        <code>docker-compose.prod.yml</code> wires the four together:
      </p>

      <pre className="snippet">
        <span className="c">
          # fill this in first — nothing has a working default
        </span>
        {'\n'}
        cp .env.production.example .env.production
        {'\n\n'}
        docker compose -f docker-compose.prod.yml \{'\n'}
        {'  '}--env-file .env.production up -d --build
      </pre>

      <p>
        Point <code>DATABASE_URL</code>, <code>REDIS_URL</code> and{' '}
        <code>S3_ENDPOINT</code> at managed services and that is the whole
        deployment. For a single box with none of those, the{' '}
        <code>bundled</code> profile brings up Postgres, Redis and MinIO
        alongside.
      </p>

      <p>
        Migrations are never run at container start. A dozen replicas booting
        together would race each other through the same migration, and one
        failing would take the rollout down rather than one job — so the{' '}
        <code>migrate</code> service runs first and the rest wait for it.
      </p>

      <h2 className="docs__h2">Ingest limits</h2>
      <p>
        Every other bound in the ingest path limits a single request — the body
        cap, the chunk ceiling, the per-session sequence limit. None of them
        limits how many requests arrive, and that matters here more than it
        might elsewhere: the public key is <em>designed</em> to ship in a
        browser bundle, and the origin allowlist is enforced by browsers rather
        than by the server. Anyone who reads a bundle can post as that project
        from a script.
      </p>
      <p>
        So each project has two ceilings, counted in Redis:{' '}
        <code>INGEST_REQUESTS_PER_MINUTE</code> stops a flood happening now, and{' '}
        <code>INGEST_BYTES_PER_DAY</code> stops a slow drip filling the object
        store over a week — the one that arrives as a bill rather than an
        outage. Past either, ingest answers <code>429</code> with{' '}
        <code>Retry-After</code> and a body naming which ceiling was hit and
        when it resets. The SDK reads that header and stops sending until it
        passes.
      </p>
      <p>
        The defaults are generous on purpose — a limit a real site trips is a
        limit somebody disables. Set either to <code>0</code> to turn it off,
        which is reasonable only when the network is private and the only client
        is your own application.
      </p>

      <h2 className="docs__h2">Retention</h2>
      <p>
        Recordings are the bulkiest thing Syncline stores, and little about a
        six-month-old session is worth what it costs to keep. Set{' '}
        <code>RETENTION_DAYS</code> on the worker and it sweeps hourly, deleting
        every session older than that along with its chunks in the object store,
        the spans no surviving recording still points at, and the raw OTLP
        bodies from those days.
      </p>
      <p>
        It is <code>0</code> out of the box, which keeps everything forever. An
        upgrade that quietly started destroying history would be the worst
        possible way to find out this feature exists, so switching it on is
        always a decision somebody made. There is no upper bound either — set it
        to <code>3650</code> if ten years is the policy.
      </p>
      <div className="callout callout--warn">
        <strong>This deletes recordings permanently.</strong> The objects are
        removed from the bucket, not moved to a trash prefix, and there is no
        undo. Check the number before setting it, and turn on bucket versioning
        first if a safety net matters.
      </div>
      <p>
        <code>RETENTION_INTERVAL_MINUTES</code> (default <code>60</code>) sets
        how often the sweep runs. Each pass works in batches of 200 sessions, so
        a first sweep against a year of backlog takes several passes rather than
        one enormous delete holding locks while ingest is still writing.
      </p>

      <h2 className="docs__h2">Roles</h2>
      <p>
        Membership decides what somebody can see; their role decides what they
        can change. <strong>Members</strong> read. <strong>Admins</strong> run
        projects — settings, key rotation, search keys, invitations.{' '}
        <strong>Owners</strong> additionally delete. Every mutation checks the
        role on the server; hidden buttons are a courtesy, not the boundary.
      </p>

      <div className="callout callout--warn">
        <strong>What is still missing.</strong> No way to delete a project at
        all — and deleting one would leave its chunks in the object store, which
        only the retention sweep above reclaims. No audit log. Put it behind a proxy that
        terminates TLS: the session cookies are <code>secure</code>, so the
        browser will not send them over plain HTTP.
      </div>
    </>
  );
}
