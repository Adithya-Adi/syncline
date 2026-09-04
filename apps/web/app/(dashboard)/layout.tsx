import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { requireViewer, viewerOrganizations } from '@/lib/session';
import { DashboardShell } from './dashboard-shell';

/**
 * Never indexed. Every page under here is one organization's data, and a crawler reaching them
 * gets a redirect to sign-in anyway — but a permalink pasted into a public issue tracker is a
 * real way for one of these URLs to be discovered and followed.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Everything under here requires a session and an organization.
 *
 * The gate is in the layout rather than in each page, so a new page is protected by existing rather
 * than by remembering to add a check. It stays a server component for that reason: the sidebar
 * shell gets only the viewer context it needs for navigation.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const viewer = await requireViewer();
  const organizations = await viewerOrganizations(viewer);

  return (
    <DashboardShell organizations={organizations} email={viewer.email}>
      {children}
    </DashboardShell>
  );
}
