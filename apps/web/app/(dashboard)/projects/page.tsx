import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/db';
import { requireViewer } from '@/lib/session';

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
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
        <Button asChild size="sm">
          <Link href="/projects/new">New project</Link>
        </Button>
      </div>

      {projects.length === 0 ? (
        <p className="mt-10 max-w-prose text-sm leading-relaxed text-muted-foreground">
          No projects yet. A project is what an API key belongs to — create one
          to get a key and start recording.
        </p>
      ) : (
        <div className="mt-6 rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[230px]">Public key</TableHead>
                <TableHead>Allowed origins</TableHead>
                <TableHead className="w-[130px] text-right">
                  Recordings
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="p-0" colSpan={4}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="grid grid-cols-[1fr_230px_1fr_130px] items-center px-4 py-2.5 text-sm"
                    >
                      <span className="truncate pr-4 font-medium">
                        {project.name}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {truncateKey(project.publicKey)}
                      </span>
                      <span className="truncate pr-4 font-mono text-xs text-muted-foreground">
                        {project.origins.length > 0
                          ? project.origins.join(', ')
                          : '—'}
                      </span>
                      <span className="text-right">
                        {project._count.sessions > 0 ? (
                          <span className="font-mono text-xs tabular-nums">
                            {project._count.sessions}
                          </span>
                        ) : (
                          // A project that has never received anything needs a next action, not a
                          // zero it cannot act on.
                          <Badge variant="secondary">Set up</Badge>
                        )}
                      </span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}

/** Enough of the key to recognise, not enough to copy by eye — the detail page has the full one. */
function truncateKey(key: string): string {
  return `${key.slice(0, 11)}…${key.slice(-4)}`;
}
