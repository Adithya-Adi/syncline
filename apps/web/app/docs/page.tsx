import Link from 'next/link';

export const metadata = { title: 'Docs' };

export default function DocsOverview() {
  return (
    <>
      <h1 className="docs__h1">Overview</h1>
      <p className="docs__lede">
        Syncline records a browser session and the backend trace behind it, then
        draws them against one clock. The interesting part is not either half —
        both exist already — but the seam between them, and how it is made
        reliable.
      </p>

      <h2 className="docs__h2">The problem</h2>
      <p>
        Session replay tools show you the browser. Tracing tools show you the
        backend. When someone reports that checkout was slow, you watch a video,
        guess a timestamp, and go looking in a second tool whose clock does not
        agree with the first one. Most of the work is correlation, by hand,
        under time pressure.
      </p>

      <h2 className="docs__h2">The mechanism</h2>
      <p>
        The browser SDK mints a W3C <code>traceparent</code> for every request
        it is allowed to touch, and writes that trace id{' '}
        <em>into the rrweb stream itself</em> as a custom event, at the frame
        the request fired. Your backend reads the header with ordinary
        OpenTelemetry instrumentation and continues the trace. The viewer then
        resolves player time to a trace id to a span tree.
      </p>
      <p>
        The consequence worth understanding: the join is by identifier, not by
        time. Clock skew between a laptop and a server changes where a span is{' '}
        <em>drawn</em>; it can never change which request a span belongs to.
        Skew is a rendering concern, and it is measured and shown rather than
        hidden.
      </p>

      <h2 className="docs__h2">The pieces</h2>
      <table className="docs__table">
        <thead>
          <tr>
            <th>Component</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>@syncline/browser</code>
            </td>
            <td>Records with rrweb, patches fetch and XHR, uploads chunks</td>
          </tr>
          <tr>
            <td>
              <code>apps/api</code>
            </td>
            <td>
              Authenticates, stores the raw body, enqueues. Parses nothing
            </td>
          </tr>
          <tr>
            <td>
              <code>apps/worker</code>
            </td>
            <td>Validates, normalizes OTLP, writes rows</td>
          </tr>
          <tr>
            <td>
              <code>apps/web</code>
            </td>
            <td>The recordings list and the viewer</td>
          </tr>
        </tbody>
      </table>

      <h2 className="docs__h2">Where to go next</h2>
      <ul className="docs__list">
        <li>
          <Link href="/docs/quickstart">Quickstart</Link> — running locally in
          about five minutes.
        </li>
        <li>
          <Link href="/docs/browser-sdk">Browser SDK</Link> — options, and the
          two rules the SDK will not break.
        </li>
        <li>
          <Link href="/docs/backend">Backend tracing</Link> — the two
          environment variables, and the CORS header everyone forgets.
        </li>
        <li>
          <Link href="/docs/privacy">Privacy and masking</Link> — read this
          before recording anything real.
        </li>
      </ul>

      <div className="callout callout--warn">
        <strong>Pre-alpha.</strong> Recordings are scoped to the organization
        that owns them and the dashboard requires an account, but there are
        still no invitations, no roles beyond owner and member, and no retention
        or deletion. Do not point this at production traffic yet.
      </div>
    </>
  );
}
