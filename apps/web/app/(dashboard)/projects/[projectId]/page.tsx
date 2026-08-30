import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  rotatePublicKey,
  rotateSecretKey,
  takeRevealedSecret,
  updateProject,
} from '../../../../lib/projects';
import { projectForViewer, requireViewer } from '../../../../lib/session';
import { CopyField } from './copy-field';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ created?: string; rotated?: string; saved?: string }>;
}) {
  const { projectId } = await params;
  const { created, rotated, saved } = await searchParams;

  const viewer = await requireViewer();
  const project = await projectForViewer(viewer, projectId);
  if (!project) notFound();

  // Shown once, then gone — there is no stored copy to show a second time.
  const secret = await takeRevealedSecret(project.id);

  return (
    <main className="form-page">
      <Link href="/projects" className="form-page__back">
        ← Projects
      </Link>

      <h1 className="form-page__title">{project.name}</h1>

      {created && (
        <p className="auth__notice">
          Project created. Copy the secret key below — it is shown once.
        </p>
      )}
      {rotated === 'public' && (
        <p className="auth__notice">
          Public key rotated. Recording stops until the new key is deployed to
          your site.
        </p>
      )}
      {saved && <p className="auth__notice">Saved.</p>}

      <section className="panel">
        <h2 className="panel__title">Keys</h2>

        <CopyField
          label="Public key"
          value={project.publicKey}
          hint="Ships in your browser bundle. Public by design — the origin allowlist is what protects it."
        />

        {secret ? (
          <CopyField
            label="Secret key"
            value={secret}
            reveal
            hint="Server-side only, for your OpenTelemetry exporter. This is the only time it is shown: only its hash is stored."
          />
        ) : (
          <div className="field">
            <span className="field__label">Secret key</span>
            <p className="panel__note">
              Stored as a hash and not recoverable. Rotate to get a new one —
              the old key stops working immediately.
            </p>
          </div>
        )}

        <div className="panel__actions">
          <form action={rotateSecretKey}>
            <input type="hidden" name="projectId" value={project.id} />
            <button className="button" type="submit">
              Rotate secret key
            </button>
          </form>

          <form action={rotatePublicKey}>
            <input type="hidden" name="projectId" value={project.id} />
            <button className="button" type="submit">
              Rotate public key
            </button>
          </form>
        </div>
        <p className="panel__note">
          Rotating the public key revokes it everywhere at once, which is the
          point — but every browser running the old bundle stops recording until
          you deploy the new one.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel__title">Settings</h2>
        <form className="auth__form" action={updateProject}>
          <input type="hidden" name="projectId" value={project.id} />

          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="field__input"
              name="name"
              defaultValue={project.name}
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Allowed origins</span>
            <textarea
              className="field__input field__input--area"
              name="origins"
              rows={3}
              defaultValue={project.origins.join('\n')}
            />
            <span className="field__hint">
              One per line. Recordings from any other origin are refused with a
              403 naming the origin, which is usually the fastest way to spot a
              typo here.
            </span>
          </label>

          <button className="button button--primary" type="submit">
            Save
          </button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title">Install</h2>
        <pre className="snippet">
          <code>
            <span className="k">import</span> {'{ startRecording }'}{' '}
            <span className="k">from</span>{' '}
            <span className="s">&apos;@syncline/browser&apos;</span>;{'\n\n'}
            startRecording({'{'}
            {'\n  '}key:{' '}
            <span className="s">&apos;{project.publicKey}&apos;</span>,{'\n  '}
            endpoint:{' '}
            <span className="s">
              &apos;
              {process.env.NEXT_PUBLIC_SYNCLINE_API ?? 'http://localhost:4000'}
              &apos;
            </span>
            ,{'\n  '}traceOrigins: [
            {project.origins.map((origin, i) => (
              <span key={origin}>
                <span className="s">&apos;{origin}&apos;</span>
                {i < project.origins.length - 1 ? ', ' : ''}
              </span>
            ))}
            ],{'\n'}
            {'}'});
          </code>
        </pre>
        <p className="panel__note">
          Your API must return{' '}
          <code>Access-Control-Allow-Headers: traceparent</code>, or every
          traced request fails preflight. See{' '}
          <Link href="/docs/browser-sdk">the SDK docs</Link>.
        </p>
      </section>
    </main>
  );
}
