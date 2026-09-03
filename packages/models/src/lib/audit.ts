/**
 * The vocabulary of the audit log.
 *
 * A closed list rather than free-form strings, because the log is read by filtering on it. Ad-hoc
 * verbs drift — `project.deleted` and `project.delete` and `deleteProject` all end up in the same
 * table, and a filter for one of them quietly misses the others at exactly the moment somebody is
 * trying to find out what happened.
 *
 * Named `noun.verb` so entries about the same thing sort together, and every verb is past-tense in
 * meaning even where it is not in spelling: an entry exists only because the action succeeded.
 */
export const AUDIT_ACTIONS = [
  'project.create',
  'project.update',
  'project.delete',
  /** Rotating either key revokes the old one everywhere at once, which is worth a record. */
  'project.keys.rotate',
  /** A search key turned on or off, or its indexed values dropped. */
  'project.key.index',
  'project.key.purge',
  'member.invite',
  'member.invite.cancel',
  'member.remove',
  'member.role',
  'organization.create',
  'organization.update',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * What an entry says in the log.
 *
 * Written here rather than at each call site so the phrasing is consistent, and so a new action
 * cannot ship with no description at all — the record type makes that a compile error.
 */
const DESCRIPTIONS: Record<AuditAction, string> = {
  'project.create': 'created project',
  'project.update': 'changed project settings',
  'project.delete': 'deleted project',
  'project.keys.rotate': 'rotated keys for',
  'project.key.index': 'changed indexing for search key',
  'project.key.purge': 'deleted indexed values for search key',
  'member.invite': 'invited',
  'member.invite.cancel': 'cancelled the invitation for',
  'member.remove': 'removed',
  'member.role': 'changed the role of',
  'organization.create': 'created organization',
  'organization.update': 'renamed organization',
};

export function describeAuditAction(action: string): string {
  return DESCRIPTIONS[action as AuditAction] ?? action;
}

/** The half of the vocabulary that is about people rather than projects, for the log's filter. */
export function isMemberAction(action: string): boolean {
  return action.startsWith('member.');
}
