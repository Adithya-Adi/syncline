import Link from 'next/link';
import { db } from '../../../lib/db';
import { requireViewer } from '../../../lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projects · Syncline' };

export default async function ProjectsPage() {
  const viewer = await requireViewer();

  const projects = await db.project.findMany({
    where: { organizationId: viewer.organizationId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { sessions: true } } },
  });

  return (
    <main className="list">
      <div className="list__header">
        <h1 className="list__h1">Projects</h1>
        <Link href="/projects/new" className="button">
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="list__empty">
          No projects yet. A project is what an API key belongs to — create one
          to get a key and start recording.
        </p>
      ) : (
        <div className="list__rows">
          <div className="list__head list__head--projects">
            <span>Name</span>
            <span>Public key</span>
            <span>Allowed origins</span>
            <span className="num">Recordings</span>
          </div>

          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="list__row list__row--projects"
            >
              <span className="list__page">{project.name}</span>
              <span className="list__when">
                {truncateKey(project.publicKey)}
              </span>
              <span className="list__user">
                {project.origins.length > 0 ? project.origins.join(', ') : '—'}
              </span>
              <span className="num">
                {project._count.sessions > 0 ? (
                  project._count.sessions
                ) : (
                  <span className="list__setup">set up</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

/** Enough of the key to recognise, not enough to copy by eye — the detail page has the full one. */
function truncateKey(key: string): string {
  return `${key.slice(0, 11)}…${key.slice(-4)}`;
}
