import Link from 'next/link';
import { createProject } from '../../../../lib/projects';
import { requireViewer } from '../../../../lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New project · Syncline' };

export default async function NewProjectPage() {
  const viewer = await requireViewer();

  return (
    <main className="form-page">
      <Link href="/projects" className="form-page__back">
        ← Projects
      </Link>

      <h1 className="form-page__title">New project</h1>
      <p className="form-page__sub">
        A project owns a pair of API keys and the list of origins allowed to
        send recordings to it. Most teams want one per application, not one per
        environment — a recording already carries its release.
      </p>

      <form className="auth__form" action={createProject}>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="field__input"
            name="name"
            required
            autoFocus
            placeholder="Checkout"
          />
        </label>

        <label className="field">
          <span className="field__label">Allowed origins</span>
          <textarea
            className="field__input field__input--area"
            name="origins"
            rows={3}
            placeholder={'https://app.acme.com\nhttp://localhost:3000'}
          />
          <span className="field__hint">
            One per line. Recordings are refused from anywhere else, which is
            what makes the public key safe to ship in a bundle.
          </span>
        </label>

        <button className="button button--primary" type="submit">
          Create project in {viewer.organizationName}
        </button>
      </form>
    </main>
  );
}
