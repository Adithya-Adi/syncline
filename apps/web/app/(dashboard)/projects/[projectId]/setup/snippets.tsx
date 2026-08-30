'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
    <Card className="mt-6">
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle>First: record the browser</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </CardHeader>

      <CardContent>
        <Tabs
          value={framework}
          onValueChange={(value) => setFramework(value as Framework)}
        >
          <TabsList>
            {(Object.keys(LABELS) as Framework[]).map((value) => (
              <TabsTrigger key={value} value={value}>
                {LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={framework} className="mt-4">
            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-4 font-mono text-xs leading-6">
              <code>{code}</code>
            </pre>
          </TabsContent>
        </Tabs>

        <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
          {origins.length > 0 ? (
            <>
              <code className="font-mono">traceOrigins</code> is filled from
              this project&rsquo;s allowlist. Only requests to those origins get
              a <code className="font-mono">traceparent</code> — the SDK never
              adds headers to anyone else&rsquo;s domain.
            </>
          ) : (
            <>
              This project has no allowed origins yet, so ingest will refuse
              every recording. Add them on the project page before installing.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
