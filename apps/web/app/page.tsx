/**
 * The landing page.
 *
 * Skeleton, deliberately: the hero of an OSS infrastructure page is the product doing its trick,
 * and that recording does not exist yet. What is here is honest — what Syncline is, how the stitch
 * works, and exactly how far along it is. The fold diagram is the argument in miniature: three
 * strata, one axis through them.
 */

const STRATA = [
  {
    label: 'Network',
    color: 'var(--stratum-network)',
    bars: [
      [6, 9],
      [22, 6],
      [52, 18],
      [86, 8],
    ],
  },
  {
    label: 'Backend',
    color: 'var(--stratum-backend)',
    bars: [
      [24, 40],
      [70, 22],
    ],
  },
  {
    label: 'Database',
    color: 'var(--stratum-database)',
    bars: [
      [30, 26],
      [74, 12],
    ],
  },
] as const;

const MILESTONES = [
  { id: 'M0', done: true, text: 'Repo, architecture, scaffold' },
  {
    id: 'M1',
    done: true,
    text: 'Browser SDK records, chunks land in Postgres',
  },
  { id: 'M2', done: true, text: 'OTLP ingest, trace stitching, the read API' },
  {
    id: 'M3',
    done: false,
    text: 'Database lane, clock-skew band, demo recording',
  },
];

export default function Landing() {
  return (
    <main className="landing">
      <div className="wordmark">syncline</div>

      <h1 className="landing__lede">
        Every layer of your stack, folded onto <em>one timeline</em>.
      </h1>

      <p className="landing__sub">
        Session replay shows you the browser. Tracing shows you the backend.
        Neither shows you the seam, so &ldquo;checkout felt slow&rdquo; is still
        archaeology: you eyeball a video, guess a timestamp, then go hunting in
        another tool with a different clock. Syncline stitches them into one
        scrubber.
      </p>

      <div className="fold" aria-hidden="true">
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

      <div className="landing__meta">
        <span>
          <strong>AGPL-3.0</strong> · self-hosted
        </span>
        <span>
          Ingests <strong>plain OTLP</strong> — no backend SDK
        </span>
        <span>
          <strong>Pre-alpha.</strong> Nothing is installable yet
        </span>
      </div>

      <section className="landing__section">
        <h2 className="landing__h2">How the stitch works</h2>
        <p className="landing__body">
          The browser SDK mints a W3C <code>traceparent</code> for every
          request, then writes that trace id{' '}
          <em>into the replay stream itself</em> as an rrweb custom event, at
          the exact frame the request fired. Your backend needs nothing from us:
          standard OpenTelemetry reads the header and continues the trace.
        </p>
        <p className="landing__body">
          The link is by id, not by timestamp. Clock skew between a browser and
          a server can misdraw a lane by a few milliseconds; it can never
          attribute a request to the wrong trace. And because the browser
          decides sampling, a recorded session can never lose the spans that
          explain it.
        </p>
      </section>

      <section className="landing__section">
        <h2 className="landing__h2">The whole backend integration</h2>
        <pre className="snippet">
          <code>
            <span className="c">
              # point any OpenTelemetry exporter at Syncline
            </span>
            {'\n'}
            <span className="k">OTEL_EXPORTER_OTLP_ENDPOINT</span>=
            <span className="s">https://syncline.example.com/v1/ingest</span>
            {'\n'}
            <span className="k">OTEL_EXPORTER_OTLP_HEADERS</span>=
            <span className="s">x-syncline-key=sk_live_...</span>
          </code>
        </pre>
      </section>

      <section className="landing__section">
        <h2 className="landing__h2">Where it is</h2>
        <div className="status">
          {MILESTONES.map((m) => (
            <div className="status__row" key={m.id}>
              <span
                className={`status__mark${m.done ? ' status__mark--done' : ''}`}
              >
                {m.done ? '■' : '□'} {m.id}
              </span>
              <span>{m.text}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing__foot">
        <a href="/sessions">Browse recordings →</a>
        <a href="https://github.com/Adithya-Adi/syncline">
          github.com/Adithya-Adi/syncline
        </a>
      </footer>
    </main>
  );
}
