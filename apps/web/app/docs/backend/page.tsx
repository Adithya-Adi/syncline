export const metadata = { title: 'Backend tracing' };

export default function Backend() {
  return (
    <>
      <h1 className="docs__h1">Backend tracing</h1>
      <p className="docs__lede">
        There is no Syncline backend SDK, and there should not be one. Syncline
        is a plain OTLP sink: if your services already emit OpenTelemetry, the
        integration is two environment variables.
      </p>

      <h2 className="docs__h2">Point your exporter at Syncline</h2>
      <pre className="snippet">
        <code>
          <span className="k">OTEL_EXPORTER_OTLP_ENDPOINT</span>=
          <span className="s">https://syncline.example.com/v1/ingest</span>
          {'\n'}
          <span className="k">OTEL_EXPORTER_OTLP_HEADERS</span>=
          <span className="s">x-syncline-key=sk_live_...</span>
        </code>
      </pre>
      <p>
        The secret key, not the public one. Public keys are browser credentials
        and are refused here.
      </p>
      <p>
        Both spellings work. An exporter appends <code>/v1/traces</code> to{' '}
        <code>OTEL_EXPORTER_OTLP_ENDPOINT</code> but uses{' '}
        <code>OTEL_EXPORTER_OTLP_TRACES_ENDPOINT</code> verbatim, so Syncline
        answers at both paths. Getting that wrong otherwise produces a 404
        swallowed inside a batch exporter, which surfaces only as traces never
        arriving.
      </p>

      <h2 className="docs__h2">Allow the header</h2>
      <div className="callout callout--warn">
        <pre className="snippet">
          <code>Access-Control-Allow-Headers: traceparent</code>
        </pre>
        Your own API has to accept this from the browser. It is the most common
        reason an integration appears broken.
      </div>

      <h2 className="docs__h2">Nothing else changes</h2>
      <p>
        Auto-instrumentation reads the incoming <code>traceparent</code>, makes
        the server span a child of the browser&rsquo;s span, and propagates the
        trace id to everything downstream — including database spans, which is
        what fills the database lane.
      </p>
      <pre className="snippet">
        <code>
          <span className="c">
            // Node, for example. Nothing Syncline-specific.
          </span>
          {'\n'}
          <span className="k">import</span> {'{ NodeSDK }'}{' '}
          <span className="k">from</span>{' '}
          <span className="s">&apos;@opentelemetry/sdk-node&apos;</span>;{'\n'}
          <span className="k">import</span> {'{ getNodeAutoInstrumentations }'}{' '}
          <span className="k">from</span>{' '}
          <span className="s">
            &apos;@opentelemetry/auto-instrumentations-node&apos;
          </span>
          ;{'\n\n'}
          <span className="k">new</span> NodeSDK({'{'}
          {'\n  '}instrumentations: [getNodeAutoInstrumentations()],{'\n'}
          {'}'}).start();
        </code>
      </pre>

      <h2 className="docs__h2">Keeping your existing vendor</h2>
      <p>
        Being an OTLP sink means Syncline does not have to replace anything. Fan
        out from a collector and send the same spans to both.
      </p>
      <pre className="snippet">
        <code>
          <span className="c"># otel-collector-config.yaml</span>
          {'\n'}exporters:{'\n  '}otlphttp/syncline:{'\n    '}endpoint:
          https://syncline.example.com/v1/ingest{'\n    '}headers:{'\n      '}
          x-syncline-key: sk_live_...{'\n  '}otlphttp/vendor:{'\n    '}endpoint:
          https://your-vendor.example.com
          {'\n\n'}service:{'\n  '}pipelines:{'\n    '}traces:{'\n      '}
          exporters: [otlphttp/syncline, otlphttp/vendor]
        </code>
      </pre>

      <h2 className="docs__h2">Formats</h2>
      <ul className="docs__list">
        <li>
          <strong>OTLP/HTTP with JSON</strong> is supported. Protobuf is not
          yet.
        </li>
        <li>
          Trace and span ids may be hex or base64. OTLP/JSON specifies hex,
          unlike proto3, and not every producer complies — so both are accepted.
        </li>
        <li>
          <code>service.name</code> comes from the resource. A span without one
          is stored as <code>unknown</code> rather than dropped.
        </li>
        <li>
          A malformed span is dropped and counted, never failing its batch. One
          bad span must not cost the other 499.
        </li>
      </ul>

      <h2 className="docs__h2">Checking it works</h2>
      <pre className="snippet">
        <code>
          curl -s localhost:4000/v1/health{'\n'}
          <span className="c">
            # {'{'}&quot;status&quot;:&quot;ok&quot;,&quot;checks&quot;:{'{'}
            &quot;database&quot;:...,&quot;redis&quot;:...{'}}'}
          </span>
        </code>
      </pre>
      <p>
        Then open a recording. If the network lane has a bar but the backend
        lane is empty, the spans are arriving under a different trace id — or
        the <code>traceparent</code> never reached your server, which is the
        CORS header again.
      </p>
    </>
  );
}
