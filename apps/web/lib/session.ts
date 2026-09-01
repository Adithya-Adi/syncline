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

  const memberships = await db.member.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'asc' },
    include: { organization: { select: { id: true, name: true } } },
  });

  // The active id can outlive the membership it names — someone removed from an organization, or
  // one that was deleted, keeps it on their session. Falling back to the earliest membership rather
  // than trusting the id means that strands nobody who still belongs somewhere.
  const membership =
    memberships.find((row) => row.organizationId === activeId) ??
    memberships[0];

  // Belonging nowhere is the only case left, and rendering an empty dashboard for it would hide a
  // broken invitation flow rather than surface it.
  if (!membership) redirect('/no-organization');

  // Write the resolved organization back when the session disagrees with it. Better Auth's own
  // organization endpoints read `activeOrganizationId` and nothing else — a null one is reported as
  // "Organization not found" — so a fallback that only this file knows about leaves invite, cancel,
  // re-role, and remove broken for every session issued before one was stamped on.
  if (session.session.activeOrganizationId !== membership.organizationId) {
    await db.authSession.update({
      where: { id: session.session.id },
      data: { activeOrganizationId: membership.organizationId },
    });
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    organizationId: membership.organization.id,
    organizationName: membership.organization.name,
    role: membership.role,
  };
}

/** Roles that may invite, remove, and re-role other members. */
const MANAGING_ROLES = new Set(['owner', 'admin']);

/**
 * Better Auth stores roles as a comma-separated string once more than one is assigned, so a plain
 * equality check silently denies an owner who also holds another role.
 */
export function canManageMembers(role: string): boolean {
  return role
    .split(',')
    .map((part) => part.trim())
    .some((part) => MANAGING_ROLES.has(part));
}

export interface ViewerOrganization {
  id: string;
  name: string;
  slug: string;
  role: string;
  active: boolean;
}

/**
 * Every organization the viewer belongs to, for the switcher.
 *
 * Read from membership rows rather than from the session, because the session knows only which
 * organization is active — and a switcher that cannot see the alternatives is a label.
 */
export async function viewerOrganizations(
  viewer: Viewer,
): Promise<ViewerOrganization[]> {
  const memberships = await db.member.findMany({
    where: { userId: viewer.userId },
    orderBy: { createdAt: 'asc' },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
    },
  });

  return memberships.map((membership) => ({
    id: membership.organization.id,
    name: membership.organization.name,
    slug: membership.organization.slug,
    role: membership.role,
    active: membership.organization.id === viewer.organizationId,
  }));
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
