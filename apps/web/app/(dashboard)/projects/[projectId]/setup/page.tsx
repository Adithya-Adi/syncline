import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { projectForViewer, requireViewer } from '@/lib/session';
import { setupStatus } from '@/lib/setup-status';
import { SetupSnippets } from './snippets';
import { SetupProgress } from './progress';
import { SetupDoctor } from './doctor';

export const dynamic = 'force-dynamic';

export default async function SetupPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const viewer = await requireViewer();
  const project = await projectForViewer(viewer, projectId);
  if (!project) notFound();

  const status = await setupStatus(project.id);
  const endpoint =
    process.env.NEXT_PUBLIC_SYNCLINE_API ?? 'http://localhost:4000';

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href={`/projects/${project.id}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {project.name}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Install the SDK
      </h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Two steps, and the second is optional until you want backend spans.
        Everything below already has this project&rsquo;s key in it.
      </p>

      <SetupProgress projectId={project.id} initial={status} />

      <SetupDoctor
        endpoint={endpoint}
        publicKey={project.publicKey}
        origins={project.origins}
      />

      <SetupSnippets
        publicKey={project.publicKey}
        endpoint={endpoint}
        origins={project.origins}
      />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Then: backend spans</CardTitle>
          <CardDescription>
            Optional, and what turns a network lane into a stitched trace. There
            is no Syncline backend SDK — point any OpenTelemetry exporter at the
            ingest endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-4 font-mono text-xs leading-6">
            <code>
              OTEL_EXPORTER_OTLP_ENDPOINT={endpoint}/v1/ingest{'\n'}
              OTEL_EXPORTER_OTLP_HEADERS=x-syncline-key=sk_...
            </code>
          </pre>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The secret key, not the public one — and it is shown only once, on{' '}
            <Link
              href={`/projects/${project.id}`}
              className="text-foreground underline underline-offset-4"
            >
              the project page
            </Link>
            , when created or rotated.
          </p>

          {/*
           * Most teams already run a Collector, and pointing it here is the only change they need
           * to make — no per-service redeploy, and the key stays in one place rather than in every
           * service's environment.
           */}
          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
            Already running an OpenTelemetry Collector? Add Syncline as one more
            exporter instead of changing every service:
          </p>
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-4 font-mono text-xs leading-6">
            <code>
              {`exporters:
  otlphttp/syncline:
    endpoint: ${endpoint}/v1/ingest
    headers:
      x-syncline-key: sk_...

service:
  pipelines:
    traces:
      receivers: [otlp]
      # Syncline alongside whatever you already export to.
      exporters: [otlphttp/syncline]`}
            </code>
          </pre>
        </CardContent>
      </Card>

      <Alert variant="destructive" className="mt-6">
        <AlertTitle>The one thing that usually breaks</AlertTitle>
        <AlertDescription className="block space-y-3">
          <span className="block">
            Your API has to accept the header the SDK adds:
          </span>
          <code className="block rounded-md border px-3 py-2 font-mono text-xs">
            Access-Control-Allow-Headers: traceparent
          </code>
          <span className="block leading-relaxed">
            Without it every traced request fails its preflight, and it looks
            like Syncline broke your site rather than like a CORS setting.
          </span>
        </AlertDescription>
      </Alert>
    </main>
  );
}
