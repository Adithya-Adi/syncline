'use client';

import { useState } from 'react';

/**
 * Install snippets, with this project's real key already in them.
 *
 * A snippet you can paste unedited is the difference between a five-minute setup and a
 * twenty-minute one, so nothing here contains a placeholder to substitute.
 */

type Framework = 'react' | 'next' | 'vanilla' | 'script';

const LABELS: Record<Framework, string> = {
  react: 'React / Vue',
  next: 'Next.js',
  vanilla: 'Plain JS',
  script: 'Script tag',
};

function snippet(
  framework: Framework,
  key: string,
  endpoint: string,
  origins: string[],
): string {
  const originList =
    origins.length > 0
      ? origins.map((o) => `'${o}'`).join(', ')
      : 'window.location.origin';

  const options = `{
  key: '${key}',
  endpoint: '${endpoint}',
  traceOrigins: [${originList}],
  // release: 'web@1.0.0',
  // user: { id: currentUser.id },
}`;

  switch (framework) {
    case 'react':
      return `// Once, at the top level — not inside a component that remounts.
import { startRecording } from '@syncline/browser';

startRecording(${options});`;

    case 'next':
      return `// app/recording.tsx
'use client';

import { useEffect } from 'react';
import { startRecording } from '@syncline/browser';

export function Recording() {
  useEffect(() => {
    const recording = startRecording(${options
      .split('\n')
      .map((line, i) => (i === 0 ? line : '    ' + line))
      .join('\n')});

    // Stops the recorder and removes the fetch patch on unmount, which matters in
    // development where the component remounts on every edit.
    return () => void recording.stop();
  }, []);

  return null;
}

// Then render <Recording /> once in app/layout.tsx.`;

    case 'vanilla':
      return `import { startRecording } from '@syncline/browser';

startRecording(${options});`;

    case 'script':
      return `<!-- Not published to a CDN yet. Bundle @syncline/browser and serve it yourself. -->
<script type="module">
  import { startRecording } from '/js/syncline.js';

  startRecording(${options
    .split('\n')
    .map((line, i) => (i === 0 ? line : '  ' + line))
    .join('\n')});
</script>`;
  }

  return '';
}

export function SetupSnippets({
  publicKey,
  endpoint,
  origins,
}: {
  publicKey: string;
  endpoint: string;
  origins: string[];
}) {
  const [framework, setFramework] = useState<Framework>('react');
  const [copied, setCopied] = useState(false);

  const code = snippet(framework, publicKey, endpoint, origins);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access is refused outside a secure context, which includes plain http on a LAN
      // address — exactly where a self-hosted install often runs. The code is selectable.
    }
  }

  return (
    <section className="panel">
      <div className="progress__head">
        <h2 className="panel__title">First: record the browser</h2>
        <button type="button" className="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="tabs">
        {(Object.keys(LABELS) as Framework[]).map((value) => (
          <button
            key={value}
            type="button"
            className={`tabs__tab${framework === value ? ' tabs__tab--active' : ''}`}
            onClick={() => setFramework(value)}
          >
            {LABELS[value]}
          </button>
        ))}
      </div>

      <pre className="snippet">
        <code>{code}</code>
      </pre>

      <p className="panel__note">
        {origins.length > 0 ? (
          <>
            <code>traceOrigins</code> is filled from this project&rsquo;s
            allowlist. Only requests to those origins get a{' '}
            <code>traceparent</code> — the SDK never adds headers to anyone
            else&rsquo;s domain.
          </>
        ) : (
          <>
            This project has no allowed origins yet, so ingest will refuse every
            recording. Add them on the project page before installing.
          </>
        )}
      </p>
    </section>
  );
}
