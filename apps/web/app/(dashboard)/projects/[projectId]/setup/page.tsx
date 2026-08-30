import Link from 'next/link';
import { notFound } from 'next/navigation';
import { projectForViewer, requireViewer } from '../../../../../lib/session';
import { setupStatus } from '../../../../../lib/setup-status';
import { SetupSnippets } from './snippets';
import { SetupProgress } from './progress';

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
    <main className="form-page form-page--wide">
      <Link href={`/projects/${project.id}`} className="form-page__back">
        ← {project.name}
      </Link>

      <h1 className="form-page__title">Install the SDK</h1>
      <p className="form-page__sub">
        Two steps, and the second one is optional until you want backend spans.
        Everything below already has this project&rsquo;s key in it.
      </p>

      <SetupProgress projectId={project.id} initial={status} />

      <SetupSnippets
        publicKey={project.publicKey}
        endpoint={endpoint}
        origins={project.origins}
      />

      <section className="panel">
        <h2 className="panel__title">Then: backend spans</h2>
        <p className="panel__note panel__note--lead">
          Optional, and what turns a network lane into a stitched trace. There
          is no Syncline backend SDK — point any OpenTelemetry exporter at the
          ingest endpoint.
        </p>
        <pre className="snippet">
          <code>
            <span className="k">OTEL_EXPORTER_OTLP_ENDPOINT</span>=
            <span className="s">{endpoint}/v1/ingest</span>
            {'\n'}
            <span className="k">OTEL_EXPORTER_OTLP_HEADERS</span>=
            <span className="s">x-syncline-key=sk_...</span>
          </code>
        </pre>
        <p className="panel__note">
          The secret key, not the public one — and it is shown only once, on{' '}
          <Link href={`/projects/${project.id}`}>the project page</Link>, when
          created or rotated.
        </p>
      </section>

      <section className="panel panel--warn">
        <h2 className="panel__title">The one thing that usually breaks</h2>
        <p className="panel__note panel__note--lead">
          Your API has to accept the header the SDK adds:
        </p>
        <pre className="snippet">
          <code>Access-Control-Allow-Headers: traceparent</code>
        </pre>
        <p className="panel__note">
          Without it every traced request fails its preflight, and it looks like
          Syncline broke your site rather than like a CORS setting. If requests
          start failing the moment you add the SDK, this is why.
        </p>
      </section>
    </main>
  );
}
