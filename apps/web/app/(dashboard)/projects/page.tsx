import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataList, DataListHeader, DataListRow } from '@/components/data-list';
import { EmptyState, PageHeader } from '@/components/page-header';
import { FolderPlus } from 'lucide-react';
import { db } from '@/lib/db';
import { requireViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projects' };

const COLUMNS = 'minmax(0,1fr) 230px minmax(0,1fr) 110px';

export default async function ProjectsPage() {
  const viewer = await requireViewer();

  const projects = await db.project.findMany({
    where: { organizationId: viewer.organizationId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { sessions: true } } },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Projects"
        description="A project is what an API key pair belongs to, and the boundary an allowed origin is checked against."
        actions={
          <Button asChild size="sm">
            <Link href="/projects/new">New project</Link>
          </Button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderPlus className="size-4" />}
          title="No projects yet"
          action={
            <Button asChild size="sm">
              <Link href="/projects/new">Create a project</Link>
            </Button>
          }
        >
          A project is what an API key belongs to — create one to get a key and
          start recording.
        </EmptyState>
      ) : (
        <DataList columns={COLUMNS}>
          <DataListHeader columns={COLUMNS}>
            <span>Name</span>
            <span>Public key</span>
            <span>Allowed origins</span>
            <span className="text-right">Recordings</span>
          </DataListHeader>

          {projects.map((project) => (
            <DataListRow
              key={project.id}
              href={`/projects/${project.id}`}
              columns={COLUMNS}
            >
              <span className="truncate font-medium">{project.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {truncateKey(project.publicKey)}
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {project.origins.length > 0 ? project.origins.join(', ') : '—'}
              </span>
              <span className="text-right">
                {project._count.sessions > 0 ? (
                  <span className="font-mono text-xs tabular-nums">
                    {project._count.sessions}
                  </span>
                ) : (
                  // A project that has never received anything needs a next action, not a zero it
                  // cannot act on.
                  <Badge variant="secondary">Set up</Badge>
                )}
              </span>
            </DataListRow>
          ))}
        </DataList>
      )}
    </main>
  );
}

/** Enough of the key to recognise, not enough to copy by eye — the detail page has the full one. */
function truncateKey(key: string): string {
  return `${key.slice(0, 11)}…${key.slice(-4)}`;
}
