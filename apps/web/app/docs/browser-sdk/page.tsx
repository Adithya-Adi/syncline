import Link from 'next/link';

export const metadata = { title: 'Browser SDK · Syncline' };

export default function BrowserSdk() {
  return (
    <>
      <h1 className="docs__h1">Browser SDK</h1>
      <p className="docs__lede">
        <code>@syncline/browser</code> records the session with rrweb and mints
        the trace context that makes the stitch possible. It is written on the
        assumption that it is a guest in someone else&rsquo;s page.
      </p>

      <h2 className="docs__h2">Setup</h2>
      <pre className="snippet">
        <code>
          <span className="k">import</span> {'{ startRecording }'}{' '}
          <span className="k">from</span>{' '}
          <span className="s">&apos;@syncline/browser&apos;</span>;{'\n\n'}
          <span className="k">const</span> recording = startRecording({'{'}
          {'\n  '}key: <span className="s">&apos;pk_live_...&apos;</span>,
          {'\n  '}endpoint:{' '}
          <span className="s">&apos;https://syncline.example.com&apos;</span>,
          {'\n  '}traceOrigins: [
          <span className="s">&apos;https://app.acme.com&apos;</span>,{' '}
          <span className="s">&apos;https://api.acme.com&apos;</span>],{'\n  '}
          release: <span className="s">&apos;web@2.4.1&apos;</span>,{'\n  '}
          user: {'{'} id: currentUser.id {'}'},{'\n'}
          {'}'});
        </code>
      </pre>

      <h2 className="docs__h2">Options</h2>
      <table className="docs__table">
        <thead>
          <tr>
            <th>Option</th>
            <th>Default</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>key</code>
            </td>
            <td>—</td>
            <td>
              Public project key. Safe to ship in a bundle; gated by the origin
              allowlist
            </td>
          </tr>
          <tr>
            <td>
              <code>endpoint</code>
            </td>
            <td>—</td>
            <td>Base URL of your Syncline API</td>
          </tr>
          <tr>
            <td>
              <code>traceOrigins</code>
            </td>
            <td>page origin</td>
            <td>
              The only origins that receive a <code>traceparent</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>release</code>
            </td>
            <td>—</td>
            <td>Ties a recording to a deploy</td>
          </tr>
          <tr>
            <td>
              <code>user</code>
            </td>
            <td>—</td>
            <td>
              <code>{'{ id }'}</code>, so you can find one person&rsquo;s
              session
            </td>
          </tr>
          <tr>
            <td>
              <code>maskAllInputs</code>
            </td>
            <td>
              <code>true</code>
            </td>
            <td>Masks every input, textarea and select</td>
          </tr>
          <tr>
            <td>
              <code>debug</code>
            </td>
            <td>
              <code>false</code>
            </td>
            <td>SDK diagnostics to the console</td>
          </tr>
        </tbody>
      </table>

      <h2 className="docs__h2">Rules the SDK will not break</h2>

      <h3 className="docs__h3">It will not break your page</h3>
      <p>
        Every patched path is wrapped, and any internal failure falls through to
        the original <code>fetch</code> or <code>XMLHttpRequest</code>. There is
        a test asserting that when both instrumentation hooks throw, the request
        still completes normally. A recording tool that takes down checkout is
        worse than no recording tool.
      </p>

      <h3 className="docs__h3">It will not inject cross-origin</h3>
      <p>
        <code>traceparent</code> goes only to origins on{' '}
        <code>traceOrigins</code>. Sending it to a third party would leak
        internal trace ids and — worse — add a header their CORS policy does not
        allow, turning a working request into a failed preflight. Subdomains do
        not match either: a third-party widget can be parked on one.
      </p>

      <h3 className="docs__h3">It will not trace itself</h3>
      <p>
        <code>window.fetch</code> is captured before the patch is installed, so
        the SDK&rsquo;s own uploads and clock probes carry no header and never
        appear in their own recording.
      </p>

      <h2 className="docs__h2">What you have to do</h2>
      <div className="callout callout--warn">
        Your API must allow the header:
        <pre className="snippet">
          <code>Access-Control-Allow-Headers: traceparent</code>
        </pre>
        This is the single most common integration failure. Without it every
        traced request fails preflight, and it looks like the SDK broke your
        site rather than like a CORS setting.
      </div>

      <h2 className="docs__h2">How it behaves</h2>
      <ul className="docs__list">
        <li>
          <strong>Flush cadence.</strong> Every 5 seconds or 64 KB, whichever
          comes first. The final flush uses <code>fetch</code> with{' '}
          <code>keepalive</code> on <code>pagehide</code>, which survives the
          page closing and still sets headers.
        </li>
        <li>
          <strong>Session identity.</strong> A ULID in{' '}
          <code>sessionStorage</code> with a 30-minute idle timeout. It survives
          navigation within a tab but not a new tab — two tabs are two
          recordings, and merging them would produce a replay whose DOM jumps
          between windows.
        </li>
        <li>
          <strong>Requests in flight</strong> at a flush boundary roll into a
          later chunk rather than being reported with a guessed duration.
        </li>
        <li>
          <strong>Compression.</strong> <code>CompressionStream</code> where
          available; an uncompressed body is a supported outcome, not a failure.
        </li>
      </ul>

      <h2 className="docs__h2">Sampling, inverted</h2>
      <p>
        A recorded session always sets <code>sampled=1</code> on the
        traceparent, and standard OTel parent-based sampling honours it. You can
        never open the replay of a slow request whose spans were sampled away —
        which would be exactly the request you wanted.
      </p>

      <p>
        Next:{' '}
        <Link href="/docs/privacy">what gets recorded and how to mask it</Link>.
      </p>
    </>
  );
}
