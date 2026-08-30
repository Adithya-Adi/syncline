import Link from 'next/link';
import { SiteShell } from './(marketing)/shell';

/**
 * The landing page.
 *
 * The hero is the product's own idea drawn at small scale — three strata with one axis through
 * them — rather than a screenshot the project cannot yet honestly show, or a gradient that says
 * nothing. Everything below answers one of the four questions someone actually has: what is this,
 * how does it work, what does it cost me to try, and is it real yet.
 */

const STRATA = [
  {
    label: 'Network',
    color: 'var(--stratum-network)',
    bars: [
      [4, 7],
      [20, 5],
      [38, 26],
      [80, 9],
    ],
  },
  {
    label: 'Backend',
    color: 'var(--stratum-backend)',
    bars: [
      [40, 22],
      [81, 7],
    ],
  },
  {
    label: 'Database',
    color: 'var(--stratum-database)',
    bars: [[44, 16]],
  },
] as const;

const PROPERTIES = [
  {
    title: 'The link is an id, not a timestamp',
    body: 'The browser mints a W3C traceparent and writes it into the replay stream at the frame the request fired. Clock skew can misdraw a lane by milliseconds; it can never attribute a request to the wrong trace.',
  },
  {
    title: 'Sampling runs backwards',
    body: 'The browser decides. A recorded session forces sampled=1, so you never open the replay of a slow request whose spans were thrown away — which is exactly the request you wanted.',
  },
  {
    title: 'No backend SDK, ever',
    body: 'Syncline is a plain OTLP sink. Point any OpenTelemetry exporter at it and the trace continues. It can sit beside your existing tracing vendor through a collector fan-out instead of replacing it.',
  },
  {
    title: 'The recording explains itself',
    body: 'Trace ids live inside the rrweb stream, not in a side table. Export a session to a file, hand it to someone else, and it still resolves to its spans.',
  },
  {
    title: 'Masked by default',
    body: 'Inputs are masked unless you opt out. Query values are stripped from recorded URLs and fragments dropped entirely. Headers and request bodies are never captured at all.',
  },
  {
    title: 'Your infrastructure',
    body: 'Postgres, Redis, and any S3-compatible store. Session recordings are the most sensitive telemetry you will ever collect, and none of it leaves your network.',
  },
];

export default function Landing() {
  return (
    <SiteShell>
      <main className="landing">
        <section className="hero">
          <p className="eyebrow">
            Session replay · distributed tracing · one scrubber
          </p>

          <h1 className="hero__lede">
            Every layer of your stack, folded onto <em>one timeline</em>.
          </h1>

          <p className="hero__sub">
            Session replay shows you the browser. Tracing shows you the backend.
            Neither shows you the seam — so &ldquo;checkout felt slow&rdquo; is
            still archaeology: eyeball a video, guess a timestamp, go hunting in
            another tool with a different clock.
          </p>

          <div className="hero__actions">
            <Link href="/docs/quickstart" className="button button--primary">
              Quickstart
            </Link>
            <a
              href="https://github.com/Adithya-Adi/syncline"
              className="button"
              rel="noreferrer"
            >
              View source
            </a>
          </div>

          <div className="fold" aria-hidden="true">
            <div className="fold__caption">
              <span className="eyebrow">One request, three layers</span>
              <span className="eyebrow">POST /api/checkout · 1,749ms</span>
            </div>
            {STRATA.map((stratum) => (
              <div className="fold__row" key={stratum.label}>
                <div className="fold__label">{stratum.label}</div>
                <div className="fold__track">
                  {stratum.bars.map(([left, width]) => (
                    <span
                      key={left}
                      className="fold__bar"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: stratum.color,
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="fold__axis" />
          </div>
          <p className="fold__legend">
            The vertical column is a core sample — one instant, cut through
            every layer at once.
          </p>
        </section>

        <section className="band">
          <div className="band__inner">
            <h2 className="h2">How the stitch works</h2>
            <ol className="steps">
              <li>
                <span className="steps__n">01</span>
                <div>
                  <strong>The browser mints the trace id.</strong> The SDK
                  patches fetch and XHR and attaches a W3C{' '}
                  <code>traceparent</code> to requests bound for origins you
                  list — never to anyone else&rsquo;s.
                </div>
              </li>
              <li>
                <span className="steps__n">02</span>
                <div>
                  <strong>It writes that id into the recording.</strong> An
                  rrweb custom event lands at the exact frame the request fired,
                  so the replay carries its own index.
                </div>
              </li>
              <li>
                <span className="steps__n">03</span>
                <div>
                  <strong>Your backend does nothing special.</strong> Standard
                  OpenTelemetry reads the header and continues the trace.
                  Database spans inherit it.
                </div>
              </li>
              <li>
                <span className="steps__n">04</span>
                <div>
                  <strong>The viewer resolves the seam.</strong> Player time, to
                  trace id, to span tree — drawn beneath the video on the same
                  clock.
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="section">
          <h2 className="h2">The whole integration</h2>
          <p className="lede">
            If your services already emit OpenTelemetry, the backend change is
            two environment variables.
          </p>
          <pre className="snippet">
            <code>
              <span className="c">
                # any OpenTelemetry exporter, any language
              </span>
              {'\n'}
              <span className="k">OTEL_EXPORTER_OTLP_ENDPOINT</span>=
              <span className="s">https://syncline.example.com/v1/ingest</span>
              {'\n'}
              <span className="k">OTEL_EXPORTER_OTLP_HEADERS</span>=
              <span className="s">x-syncline-key=sk_live_...</span>
            </code>
          </pre>
          <p className="lede">And on the front end:</p>
          <pre className="snippet">
            <code>
              <span className="k">import</span> {'{ startRecording }'}{' '}
              <span className="k">from</span>{' '}
              <span className="s">&apos;@syncline/browser&apos;</span>;{'\n\n'}
              startRecording({'{'}
              {'\n  '}key: <span className="s">&apos;pk_live_...&apos;</span>,
              {'\n  '}endpoint:{' '}
              <span className="s">
                &apos;https://syncline.example.com&apos;
              </span>
              ,{'\n  '}
              traceOrigins: [
              <span className="s">&apos;https://api.acme.com&apos;</span>],
              {'\n'}
              {'}'});
            </code>
          </pre>
        </section>

        <section className="section">
          <h2 className="h2">What makes it different</h2>
          <div className="feature-grid">
            {PROPERTIES.map((p) => (
              <div className="card" key={p.title}>
                <h3 className="card__title">{p.title}</h3>
                <p className="card__body">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <h2 className="h2">Honest status</h2>
          <p className="lede">
            Pre-alpha. The pipeline works end to end — a browser records, the
            trace stitches, the viewer draws both against one clock — but this
            is not yet something to put in front of your users.
          </p>
          <div className="status">
            <div className="status__row">
              <span className="status__mark status__mark--done">■ Works</span>
              <span>
                Recording, ingest, OTLP, the stitch, the viewer, timeline zoom,
                recordings list
              </span>
            </div>
            <div className="status__row">
              <span className="status__mark status__mark--done">■ Works</span>
              <span>
                Accounts and organizations, projects and API keys,
                per-organization access control
              </span>
            </div>
            <div className="status__row">
              <span className="status__mark">□ Not yet</span>
              <span>
                Invitations and roles, retention and deletion, a published SDK
                bundle, container images
              </span>
            </div>
          </div>
          <p className="lede">
            Recordings are readable only by members of the organization that
            owns them. Still missing before production: invitations, roles,
            retention and deletion, and an official container image.
          </p>
        </section>

        <section className="cta">
          <h2 className="h2">Running in about five minutes</h2>
          <p className="lede">
            Docker for Postgres, Redis and MinIO. Three Node processes. One
            seeded project key.
          </p>
          <div className="hero__actions">
            <Link href="/docs/quickstart" className="button button--primary">
              Read the quickstart
            </Link>
            <Link href="/docs/architecture" className="button">
              How it is built
            </Link>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
