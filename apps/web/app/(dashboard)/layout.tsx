import Link from 'next/link';
import type { ReactNode } from 'react';

import { LogoMark } from '@/components/logo';
import { requireViewer } from '@/lib/session';
import { AccountMenu } from './account-menu';
import { NavLinks } from './nav-links';

/**
 * Everything under here requires a session and an organization.
 *
 * The gate is in the layout rather than in each page, so a new page is protected by existing rather
 * than by remembering to add a check. It stays a server component for that reason — the two pieces
 * that need the browser (the active-link indicator and the account menu) are leaves.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const viewer = await requireViewer();

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link
            href="/sessions"
            className="flex items-center gap-2 transition-opacity duration-200 hover:opacity-80"
          >
            <LogoMark className="size-[18px]" />
            <span className="font-display text-[15px] font-semibold tracking-[-0.01em]">
              syncline
            </span>
          </Link>

          <NavLinks />

          <div className="ml-auto">
            <AccountMenu
              organizationName={viewer.organizationName}
              email={viewer.email}
            />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
