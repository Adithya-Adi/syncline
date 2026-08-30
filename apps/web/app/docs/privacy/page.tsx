export const metadata = { title: 'Privacy and masking' };

export default function Privacy() {
  return (
    <>
      <h1 className="docs__h1">Privacy and masking</h1>
      <p className="docs__lede">
        Session replay records what a person is looking at. It is the most
        sensitive telemetry you will ever collect, and the defaults are set
        accordingly — every one of them errs toward recording less.
      </p>

      <h2 className="docs__h2">What is recorded by default</h2>
      <table className="docs__table">
        <thead>
          <tr>
            <th>Captured</th>
            <th>Not captured</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>DOM structure and mutations</td>
            <td>Input values — masked unless you opt out</td>
          </tr>
          <tr>
            <td>Mouse position and clicks</td>
            <td>Request and response bodies</td>
          </tr>
          <tr>
            <td>Request method, URL path, status, timing</td>
            <td>Request headers, including cookies and tokens</td>
          </tr>
          <tr>
            <td>
              Query parameter <em>names</em>
            </td>
            <td>
              Query parameter <em>values</em>
            </td>
          </tr>
          <tr>
            <td>Viewport size, user agent</td>
            <td>URL fragments, where implicit-flow tokens live</td>
          </tr>
        </tbody>
      </table>
      <p>
        A recorded URL looks like <code>/search?token&amp;page</code> — enough
        to see the shape of the request, not enough to leak a session token, an
        email address, or what someone searched for.
      </p>

      <h2 className="docs__h2">Masking specific elements</h2>
      <p>Two class names, applied by you, on the page:</p>
      <pre className="snippet">
        <code>
          <span className="c">
            &lt;!-- structure recorded, text replaced --&gt;
          </span>
          {'\n'}&lt;div class=
          <span className="s">&quot;syncline-mask&quot;</span>&gt;…&lt;/div&gt;
          {'\n\n'}
          <span className="c">
            &lt;!-- subtree never recorded at all --&gt;
          </span>
          {'\n'}&lt;section class=
          <span className="s">&quot;syncline-block&quot;</span>
          &gt;…&lt;/section&gt;
        </code>
      </pre>
      <p>
        Use <code>syncline-block</code> for anything you would not want
        appearing in a screenshot pasted into a support ticket: payment fields,
        identity documents, medical detail, private messages. Masking is not a
        substitute for blocking — a masked field still reveals that it was
        filled, how long it took, and where the cursor went.
      </p>

      <h2 className="docs__h2">Turning masking off</h2>
      <p>
        <code>maskAllInputs: false</code> exists, and it records what people
        type. Read that sentence again before setting it. If you need one field
        visible, block the surrounding area and leave that field unblocked,
        rather than unmasking everything.
      </p>

      <h2 className="docs__h2">What your database spans contain</h2>
      <p>
        Syncline stores span attributes as your instrumentation emits them. If{' '}
        <code>db.statement</code> contains literal values rather than
        placeholders, those values are stored and displayed. That is your
        instrumentation&rsquo;s choice, and worth checking before pointing this
        at production.
      </p>

      <h2 className="docs__h2">Where the data lives</h2>
      <p>
        In your Postgres and your object store. Syncline is self-hosted;
        recordings never leave your infrastructure. That is a large part of why
        the project exists — the alternative is shipping video of your
        users&rsquo; sessions to someone else.
      </p>

      <div className="callout callout--warn">
        <strong>Retention is not implemented.</strong> Nothing expires or is
        deleted automatically, and there is no per-user deletion endpoint. If
        you have obligations under GDPR, CCPA or similar, they are yours to meet
        by hand until this exists. Treat it as disqualifying for production use.
      </div>

      <h2 className="docs__h2">Access control</h2>
      <p>
        Recordings are readable only by members of the organization that owns
        the project they were recorded into. The dashboard resolves your session
        on the server and scopes every query by organization. A recording
        belonging to someone else is not forbidden, it is simply not found — a
        403 would confirm it exists.
      </p>
      <p>
        The ingest API&rsquo;s read endpoints require a project&rsquo;s secret
        key and return only that project&rsquo;s recordings. They were briefly
        protected by nothing more than session ids being unguessable, which
        meant the data path went around the dashboard entirely.
      </p>
      <p>
        What is <em>not</em> built yet: invitations, roles beyond owner and
        member, and audit logging. Anyone you add to an organization can watch
        every recording in it.
      </p>
    </>
  );
}
