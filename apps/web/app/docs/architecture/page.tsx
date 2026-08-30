export const metadata = { title: 'Architecture' };

export default function Architecture() {
  return (
    <>
      <h1 className="docs__h1">Architecture</h1>
      <p className="docs__lede">
        The shape of the system, and the handful of decisions that determine
        everything else. The full contract lives in{' '}
        <code>docs/ARCHITECTURE.md</code> in the repository.
      </p>

      <pre className="snippet snippet--diagram">
        <code>
          {`browser                        your backend
┌──────────────┐               ┌──────────────┐
│ syncline-sdk │               │ your app     │
│ rrweb capture│  traceparent  │ + OTel SDK   │
│ fetch patch  ├──────────────►│              │
└──────┬───────┘               └──────┬───────┘
       │ chunks + links               │ OTLP/HTTP
       ▼                              ▼
   ┌────────────────────────────────────────┐
   │ apps/api      authenticate, store, 202 │
   └───────────────┬────────────────────────┘
                   │ BullMQ (pointers, not bodies)
   ┌───────────────▼────────────────────────┐
   │ apps/worker   parse → normalize → store│
   └──────┬──────────────────┬──────────────┘
          ▼                  ▼
     Postgres           object store
          ▲
   ┌──────┴──────────────────┐
   │ apps/web      the viewer│
   └─────────────────────────┘`}
        </code>
      </pre>

      <h2 className="docs__h2">The API parses nothing</h2>
      <p>
        Ingest is the one path that must not fall over under load, and the one
        path whose input is attacker-controlled. So the API authenticates the
        key, bounds the size, streams the body to object storage, enqueues a job
        carrying the storage key, and returns 202. Decompression, schema
        validation and indexing happen in the worker, where a slow or hostile
        payload costs a queue slot instead of an HTTP connection.
      </p>
      <p>
        This also keeps queue jobs small. Payloads are pointers, never megabytes
        — Redis is a queue, not a blob store.
      </p>

      <h2 className="docs__h2">The join is by identifier</h2>
      <p>
        A browser clock and a server clock disagree, sometimes by hours. If the
        two halves were correlated by timestamp, every skewed clock would be a
        correctness bug. Instead the browser mints the trace id, the backend
        continues it, and the join is an equality check on 128 bits. Skew only
        affects where a span is <em>drawn</em>, and the viewer shows the
        measurement uncertainty rather than pretending it is not there.
      </p>

      <h2 className="docs__h2">Sampling is inverted</h2>
      <p>
        Normally the backend decides what to keep and the frontend finds out
        later, which produces the worst possible artifact: the replay of a slow
        request whose spans were discarded. Here the browser decides. A recorded
        session forces <code>sampled=1</code>, and parent-based sampling honours
        it.
      </p>

      <h2 className="docs__h2">The recording carries its own index</h2>
      <p>
        Trace ids are written into the rrweb stream as custom events rather than
        kept in a side table. A session file is therefore self-describing:
        export it, hand it to someone else, and it still resolves to its spans.
        Two events per request, not one — rrweb&rsquo;s log is append-only, so a
        duration cannot be stamped onto an event already emitted.
      </p>

      <h2 className="docs__h2">Storage split</h2>
      <p>
        Postgres holds the index; the object store holds the film. A five-minute
        recording is tens of megabytes of DOM mutations and has no business in a
        relational database. Spans are the one table with unbounded write
        volume, so everything reaches them through a <code>SpanStore</code>{' '}
        interface — the eventual move to ClickHouse should be one new class, not
        a rewrite.
      </p>

      <h2 className="docs__h2">Everything downstream is idempotent</h2>
      <p>
        A queue promises at-least-once delivery and nothing more. Chunks upsert
        on <code>(sessionId, seq)</code>, spans on{' '}
        <code>(traceId, spanId)</code>, and a body that will never validate
        raises an unrecoverable error so it fails once rather than three times
        with backoff.
      </p>

      <h2 className="docs__h2">Packages</h2>
      <table className="docs__table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>@syncline/protocol</code>
            </td>
            <td>
              Every contract crossing a process boundary. A leaf with no
              workspace deps
            </td>
          </tr>
          <tr>
            <td>
              <code>@syncline/models</code>
            </td>
            <td>Prisma schema, client, and the SpanStore port</td>
          </tr>
          <tr>
            <td>
              <code>@syncline/otlp</code>
            </td>
            <td>The only code that knows OpenTelemetry&rsquo;s wire format</td>
          </tr>
          <tr>
            <td>
              <code>@syncline/storage</code>
            </td>
            <td>One object-store client, so API and worker cannot drift</td>
          </tr>
          <tr>
            <td>
              <code>@syncline/browser</code>
            </td>
            <td>The recorder that ships to your site</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
