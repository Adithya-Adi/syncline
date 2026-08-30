export const metadata = { title: 'Self-hosting · Syncline' };

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

      <div className="callout callout--warn">
        <strong>Not production-ready.</strong> There are no official container
        images, no retention or deletion, and no authentication on the web app.
        Run it on a trusted network.
      </div>
    </>
  );
}
