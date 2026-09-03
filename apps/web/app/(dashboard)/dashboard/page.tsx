import Link from 'next/link';
import type { ReactNode } from 'react';
import { FolderKanban, KeyRound, Layers3 } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { LIVE, requireViewer } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

const countFormat = new Intl.NumberFormat('en-US');

export default async function DashboardPage() {
  const viewer = await requireViewer();
  const projects = await db.project.findMany({
    where: { organizationId: viewer.organizationId, ...LIVE },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      publicKey: true,
      origins: true,
      _count: { select: { sessions: true } },
    },
  });

  const totalRecordings = projects.reduce(
    (total, project) => total + project._count.sessions,
    0,
  );
  const activeProjects = projects.filter(
    (project) => project._count.sessions > 0,
  ).length;
  const allowedOrigins = projects.reduce(
    (total, project) => total + project.origins.length,
    0,
  );

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-7 px-5 py-7 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Dashboard"
        title="Select a project"
        description={
          <>
            Recordings are scoped by project. Choose one from this page or the
            sidebar to inspect its captures.
          </>
        }
        actions={
          <Button asChild size="sm">
            <Link href="/projects/new">New project</Link>
          </Button>
        }
      />

      <section className="grid gap-px overflow-hidden rounded-lg border border-border/80 bg-border/70 sm:grid-cols-3">
        <Metric
          icon={<FolderKanban className="size-3.5" />}
          label="Projects"
          value={formatCount(projects.length)}
          detail={`${formatCount(activeProjects)} with recordings`}
        />
        <Metric
          icon={<Layers3 className="size-3.5" />}
          label="Recordings"
          value={formatCount(totalRecordings)}
          detail="Across all projects"
        />
        <Metric
          icon={<KeyRound className="size-3.5" />}
          label="Allowed origins"
          value={formatCount(allowedOrigins)}
          detail="Configured ingest origins"
        />
      </section>

    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 bg-background px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 truncate font-display text-2xl font-semibold tabular-nums">
        {value}
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

function formatCount(value: number): string {
  return countFormat.format(value);
}
