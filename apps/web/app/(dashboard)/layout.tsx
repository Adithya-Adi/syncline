import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireViewer } from '../../lib/session';
import { SignOutButton } from './sign-out';

/**
 * Everything under here requires a session and an organization.
 *
 * The gate is in the layout rather than in each page so a new page is protected by existing, not by
 * remembering to add a check.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const viewer = await requireViewer();

  return (
    <>
      <nav className="nav">
        <Link href="/sessions" className="wordmark">
          syncline
        </Link>
        <div className="nav__links">
          <Link href="/sessions">Recordings</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/docs">Docs</Link>
          <span className="nav__org" title={`Signed in as ${viewer.email}`}>
            {viewer.organizationName}
          </span>
          <SignOutButton />
        </div>
      </nav>
      {children}
    </>
  );
}
