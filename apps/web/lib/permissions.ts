import type { Viewer } from './session';

/**
 * Who may do what.
 *
 * One table, read by every mutation, rather than a role comparison written out at each call site.
 * Scattered checks are how a new action ships with no check at all: nothing fails, nothing is
 * logged, and the gap is found by whoever is affected by it.
 *
 * Roles come from Better Auth's organization plugin — `owner`, `admin`, `member`. Membership is
 * already the tenant boundary and is enforced separately, by scoping every query through the
 * viewer's organization. This is the second question, asked only after that one: given that you
 * can see this project, may you change it?
 *
 * The split is least-privilege by default. A member reads; an admin runs the project; only an
 * owner can destroy one. That is stricter than most small teams need, and deliberately so — the
 * owner can promote in two clicks, and the alternative failure is somebody's recordings being
 * deleted by a colleague who was only ever meant to watch them.
 */

export const PERMISSIONS = [
  /** Change a project's name and origin allowlist. */
  'project:write',
  /** Create a project in this organization. */
  'project:create',
  /** Mint new keys, which revokes the old ones everywhere at once. */
  'project:keys',
  /** Delete a project and every recording in it. Owner only, and irreversible. */
  'project:delete',
  /** Stop indexing a search key, or delete what is stored under one. */
  'data:manage',
  /** Invite, remove and re-role people. */
  'members:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const BY_ROLE: Record<string, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: [
    'project:write',
    'project:create',
    'project:keys',
    'data:manage',
    'members:manage',
  ],
  member: [],
};

/**
 * Better Auth stores multiple roles as one comma-separated string, so an owner who also holds
 * another role reads as `"owner,member"` and a plain equality check silently denies them.
 */
export function rolesOf(role: string): string[] {
  return role
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** True when any of the viewer's roles grants the permission. */
export function can(viewer: Viewer, permission: Permission): boolean {
  return rolesOf(viewer.role).some((role) =>
    BY_ROLE[role]?.includes(permission),
  );
}

/**
 * A refusal that is a refusal, not a crash.
 *
 * Thrown by the server actions, which is the enforcement that counts — the UI hides controls
 * somebody cannot use, but a hidden button is a courtesy and a stale page or a crafted request
 * reaches the action anyway.
 */
export class PermissionError extends Error {
  constructor(permission: Permission) {
    super(`Your role does not allow this (${permission}).`);
    this.name = 'PermissionError';
  }
}

export function requirePermission(
  viewer: Viewer,
  permission: Permission,
): void {
  if (!can(viewer, permission)) throw new PermissionError(permission);
}

/** The strongest role held, for display. */
export function roleLabel(role: string): string {
  const held = rolesOf(role);
  for (const rank of ['owner', 'admin', 'member']) {
    if (held.includes(rank)) return rank;
  }
  return held[0] ?? 'member';
}
