import Link from 'next/link';
import type { ReactNode } from 'react';
import { Separator } from '@/components/ui/separator';
import { requireViewer } from '@/lib/session';
import { SignOutButton } from './sign-out';

/**
 * Everything under here requires a session and an organization.
 *
 * The gate is in the layout rather than in each page, so a new page is protected by existing rather
 * than by remembering to add a check.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const viewer = await requireViewer();

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link
            href="/sessions"
            className="font-mono text-sm font-medium tracking-tight"
          >
            syncline
          </Link>

          <nav className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link
              href="/sessions"
              className="transition-colors hover:text-foreground"
            >
              Recordings
            </Link>
            <Link
              href="/projects"
              className="transition-colors hover:text-foreground"
            >
              Projects
            </Link>
            <Link
              href="/docs"
              className="transition-colors hover:text-foreground"
            >
              Docs
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <span
              className="text-muted-foreground"
              title={`Signed in as ${viewer.email}`}
            >
              {viewer.organizationName}
            </span>
            <Separator orientation="vertical" className="h-4" />
            <SignOutButton />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
