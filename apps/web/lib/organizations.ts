import { db } from './db';
import type { Viewer } from './session';

/**
 * Organization membership reads.
 *
 * Mutations go through Better Auth's organization endpoints, which own the permission rules — this
 * file deliberately does not reimplement them. What Better Auth does not offer is a read shaped for
 * a table, and its own invitation lookup refuses anyone but the recipient, which makes it useless
 * for rendering an admin's pending-invitation list. So reads live here, scoped the same way every
 * other query in the app is: through the viewer's organization.
 */

export interface OrganizationMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: number;
  /** True for the viewer's own membership, which cannot be removed from this page. */
  isViewer: boolean;
}

export async function organizationMembers(
  viewer: Viewer,
): Promise<OrganizationMember[]> {
  const members = await db.member.findMany({
    where: { organizationId: viewer.organizationId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return members.map((member) => ({
    id: member.id,
    userId: member.user.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    joinedAt: member.createdAt.getTime(),
    isViewer: member.user.id === viewer.userId,
  }));
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  expiresAt: number;
  expired: boolean;
}

/**
 * Invitations still waiting to be accepted.
 *
 * Expired rows keep their `pending` status until something touches them, so the query returns them
 * and the page marks them expired. Hiding them would leave an admin wondering why re-inviting the
 * same address is refused.
 */
export async function pendingInvitations(
  viewer: Viewer,
): Promise<PendingInvitation[]> {
  const invitations = await db.invitation.findMany({
    where: { organizationId: viewer.organizationId, status: 'pending' },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { name: true, email: true } } },
  });

  const now = Date.now();

  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role ?? 'member',
    invitedBy: invitation.user.name || invitation.user.email,
    expiresAt: invitation.expiresAt.getTime(),
    expired: invitation.expiresAt.getTime() < now,
  }));
}

export interface InvitationTarget {
  id: string;
  email: string;
  role: string;
  organizationName: string;
  expiresAt: number;
  status: string;
  expired: boolean;
}

/**
 * The invitation behind an accept link, read without requiring a session.
 *
 * The accept page has to render for someone who is signed out, or signed in as the wrong account —
 * both are the common case for a link pasted into a chat window. Better Auth's own lookup rejects
 * exactly those two callers, so this reads the row directly and the page decides how much of it to
 * show.
 */
export async function invitationById(
  invitationId: string,
): Promise<InvitationTarget | null> {
  const invitation = await db.invitation.findUnique({
    where: { id: invitationId },
    include: { organization: { select: { name: true } } },
  });

  if (!invitation) return null;

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role ?? 'member',
    organizationName: invitation.organization.name,
    expiresAt: invitation.expiresAt.getTime(),
    status: invitation.status,
    expired: invitation.expiresAt.getTime() < Date.now(),
  };
}

/**
 * Hides most of an address from someone who is not its owner.
 *
 * An invitation id is unguessable, but it travels through chat apps and pasted links, so the page
 * behind it should not hand a stranger a colleague's full address. The recipient sees their own
 * address in full — they already know it, and recognizing it is how they confirm the link is theirs.
 */
export function maskEmail(email: string): string {
  const [local = '', domain] = email.split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(local.length - 1, 2))}@${domain}`;
}
