import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from './auth';
import { can } from './permissions';
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
 * The viewer and their organization, or a redirect out of the dashboard.
 *
 * The session's active organization is authoritative while a session lasts — switching writes it
 * there. What this adds is the two cases the session cannot answer: an id that has gone stale, and
 * a brand-new session belonging to someone who was last working somewhere in particular.
 */
export async function requireViewer(): Promise<Viewer> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect('/sign-in');

  const activeId = session.session.activeOrganizationId ?? undefined;

  const [memberships, preference] = await Promise.all([
    db.member.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'asc' },
      include: { organization: { select: { id: true, name: true } } },
    }),
    db.userPreference.findUnique({
      where: { userId: session.user.id },
      select: { lastOrganizationId: true },
    }),
  ]);

  const belongsTo = (id?: string) =>
    id ? memberships.find((row) => row.organizationId === id) : undefined;

  // In order: what the session says, then where they left off, then their earliest membership.
  //
  // Each fallback covers a way the one before it goes stale. An active id outlives the membership
  // it names — someone removed from an organization, or one that was deleted, keeps it on their
  // session — and the remembered one can be just as stale for the same reason. Checking both
  // against membership rather than trusting either means nothing strands someone who still belongs
  // somewhere.
  const membership =
    belongsTo(activeId) ??
    belongsTo(preference?.lastOrganizationId ?? undefined) ??
    memberships[0];

  // Belonging nowhere is now the ordinary state of a new account: nothing is provisioned at
  // sign-up, because an organization named after whoever registered is a guess nobody can correct.
  // Naming one is the first thing the dashboard asks for.
  if (!membership) redirect('/organizations/new');

  // Write the resolved organization back when the session disagrees with it. Better Auth's own
  // organization endpoints read `activeOrganizationId` and nothing else — a null one is reported as
  // "Organization not found" — so a fallback that only this file knows about leaves invite, cancel,
  // re-role, and remove broken for every session issued before one was stamped on.
  if (activeId !== membership.organizationId) {
    await db.authSession.update({
      where: { id: session.session.id },
      data: { activeOrganizationId: membership.organizationId },
    });
  }

  // And remember it beyond this session, so the next sign-in opens here rather than back at the
  // earliest membership. This is where a switch is recorded: `setActive` writes the session, and
  // the first page load afterwards is what notices.
  if (preference?.lastOrganizationId !== membership.organizationId) {
    await rememberOrganization(session.user.id, membership.organizationId);
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

/**
 * Records where someone is working, to be reopened at their next sign-in.
 *
 * Best-effort: a failure here costs the next sign-in its starting organization, which is a worse
 * guess rather than a broken page, and is not worth failing a dashboard render over.
 */
async function rememberOrganization(
  userId: string,
  organizationId: string,
): Promise<void> {
  try {
    await db.userPreference.upsert({
      where: { userId },
      create: { userId, lastOrganizationId: organizationId },
      update: { lastOrganizationId: organizationId },
    });
  } catch {
    // See above.
  }
}

/**
 * Kept as a named helper because the members page reads better for it, but the rule itself lives
 * in one table — see `permissions.ts`. Two copies of "who may manage members" is two answers the
 * day one of them is updated.
 */
export function canManageMembers(role: string): boolean {
  return can({ role } as Viewer, 'members:manage');
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
    where: {
      id: projectId,
      organizationId: viewer.organizationId,
      ...LIVE,
    },
  });
}

/**
 * The filter that hides a deleted project, written once.
 *
 * Deletion is a mark rather than a `DELETE` — the worker does the destroying, which can take until
 * the next sweep. In between, the row is still there, and every query that forgets this clause
 * shows somebody a project they deleted. Spelling it out at each call site is how the fourth query
 * ships without it, so there is one spelling and it is imported.
 */
export const LIVE = { deletedAt: null } as const;
