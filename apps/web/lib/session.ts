import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from './auth';
import { db } from './db';

/**
 * Server-side session and tenancy helpers.
 *
 * Every dashboard page resolves the viewer through these rather than trusting anything in the
 * request. `activeOrganization` is the tenant boundary: once you have it, a query scoped to it
 * cannot return another organization's data by accident.
 */

export interface Viewer {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: string;
}

export async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/**
 * The viewer and their organization, or a redirect to sign-in.
 *
 * Better Auth tracks an active organization on the session, but it is unset until something sets
 * it — including for the very first sign-in. Falling back to the earliest membership means a
 * single-organization install, which is nearly all of them, never has to choose one.
 */
export async function requireViewer(): Promise<Viewer> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect('/sign-in');

  const activeId = session.session.activeOrganizationId ?? undefined;

  const membership = await db.member.findFirst({
    where: {
      userId: session.user.id,
      ...(activeId ? { organizationId: activeId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    include: { organization: { select: { id: true, name: true } } },
  });

  // A user with no membership cannot be shown anything, and silently rendering an empty dashboard
  // would hide a broken invitation flow rather than surface it.
  if (!membership) redirect('/no-organization');

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    organizationId: membership.organization.id,
    organizationName: membership.organization.name,
    role: membership.role,
  };
}

/**
 * Loads a project only if the viewer's organization owns it.
 *
 * Scoping the lookup rather than fetching then checking means a wrong id is indistinguishable from
 * one belonging to someone else — both are simply not found, which is the only answer that does not
 * confirm the project exists.
 */
export async function projectForViewer(viewer: Viewer, projectId: string) {
  return db.project.findFirst({
    where: { id: projectId, organizationId: viewer.organizationId },
  });
}
