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
        <p className="panel__note panel__note--lead">
          Snippets with this key already in them, plus a live check that names
          the step that has not happened yet rather than leaving you staring at
          an empty list.
        </p>
        <div className="panel__actions">
          <Link
            href={`/projects/${project.id}/setup`}
            className="button button--primary"
          >
            Set up the SDK
          </Link>
        </div>
      </section>
    </main>
  );
}
