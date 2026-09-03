import Link from 'next/link';
import { ArrowUpRight, FolderKanban, FolderPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { can } from '@/lib/permissions';
import { EmptyState, PageHeader } from '@/components/page-header';
import { db } from '@/lib/db';
import { LIVE, requireViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const viewer = await requireViewer();

  const canCreate = can(viewer, 'project:create');

  const projects = await db.project.findMany({
    where: { organizationId: viewer.organizationId, ...LIVE },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { sessions: true } } },
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Choose a project to view its recordings."
        // Hidden rather than shown and then refused. The action checks the role regardless — a
        // hidden control is a courtesy, and a stale page still reaches the server.
        actions={
          canCreate ? (
            <Button asChild size="sm">
              <Link href="/projects/new">New project</Link>
            </Button>
          ) : undefined
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderPlus className="size-4" />}
          title="No projects yet"
          action={
            canCreate ? (
              <Button asChild size="sm">
                <Link href="/projects/new">Create a project</Link>
              </Button>
            ) : undefined
          }
        >
          {canCreate
            ? 'Create a project to get an API key and start recording.'
            : 'Nobody has created one yet. An admin or the owner can add the first.'}
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}/recordings`}
              className="group rounded-lg border border-border/80 bg-background p-5 transition-colors duration-200 hover:border-network/50 hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="flex size-10 items-center justify-center rounded-md border border-border bg-muted/50 text-network">
                  <FolderKanban className="size-4" />
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              </div>
              <div className="mt-6 truncate font-display text-base font-semibold">
                {project.name}
              </div>
              <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {truncateKey(project.publicKey)}
              </div>
              <div className="mt-6 flex items-center justify-between gap-3 border-t border-border/70 pt-3 text-xs">
                <span className="text-muted-foreground">Recordings</span>
                <span className="font-mono tabular-nums">
                  {project._count.sessions}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function truncateKey(key: string): string {
  return `${key.slice(0, 11)}...${key.slice(-4)}`;
}
