import type { AuditAction } from '@syncline/models';
import type { AuditActor } from './audit-actor';
import { db } from './db';
import type { Viewer } from './session';

/**
 * Recording what somebody changed.
 *
 * Called at the end of a mutation, after it succeeded. Logging the intent before the write would
 * put entries in the log for things that then failed, which is worse than no log: it is a record
 * that is wrong, and the whole value of this table is that it can be believed.
 *
 * The actor is taken from the resolved viewer rather than from anything the form sent, for the
 * same reason the mutation itself is — a server action is a public endpoint, and an audit log
 * whose author field is attacker-controlled records whatever the attacker prefers.
 */

interface AuditInput {
  action: AuditAction;
  targetId?: string;
  targetLabel?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Best-effort by design.
 *
 * A failed insert here must not fail the mutation that already committed. The alternative — a
 * transaction spanning both — means a full audit table takes the whole product down, and the
 * product is what people are paying for. So a lost entry is a gap somebody may notice, and a
 * refused deletion is an outage everybody notices.
 */
export async function audit(viewer: Viewer, input: AuditInput): Promise<void> {
  await record(
    viewer.organizationId,
    { id: viewer.userId, email: viewer.email, name: viewer.name },
    input,
  );
}

/**
 * The same, for the member mutations, which have no viewer to hand.
 *
 * Those run inside Better Auth's own endpoints rather than in one of our server actions — see
 * `audit-actor.ts` for why the actor arrives separately.
 */
export async function record(
  organizationId: string,
  actor: AuditActor,
  input: AuditInput,
): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        organizationId,
        actorId: actor.id,
        actorEmail: actor.email,
        actorName: actor.name,
        action: input.action,
        targetId: input.targetId ?? null,
        targetLabel: input.targetLabel ?? null,
        metadata: (input.metadata ?? null) as never,
      },
    });
  } catch {
    // See above.
  }
}

export interface AuditEntry {
  id: string;
  actorName: string;
  actorEmail: string;
  action: string;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/** Entries per page. */
export const AUDIT_PAGE_SIZE = 100;

export interface AuditPage {
  entries: AuditEntry[];
  /** Opaque cursor for the page of newer entries, absent on the newest page. */
  newerCursor?: string;
  /** Opaque cursor for the page of older entries, absent on the oldest page. */
  olderCursor?: string;
}

/**
 * One page of the log, newest first.
 *
 * Keyset rather than an offset, and the reason is the direction this list grows: entries are newest
 * first, so a new one arrives at the top — exactly where an offset shifts every page boundary below
 * it and repeats a row somebody has already read.
 *
 * The cursor is `(createdAt, id)` because `createdAt` alone is not a total order: one mutation can
 * write several entries in the same millisecond, and a cursor that cannot separate them either
 * shows a row twice or skips it. `id` is a cuid, so it carries no time of its own — it is only ever
 * a tiebreaker, never the sort.
 */
export async function auditEventPage(
  viewer: Viewer,
  options: { before?: string; after?: string } = {},
): Promise<AuditPage> {
  // `after` wins if somebody hand-assembles a URL carrying both. One direction has to, and the
  // alternative is a query with two contradictory bounds that quietly returns nothing.
  const backwards = options.after !== undefined;
  const cursor = parseCursor(options.after ?? options.before);

  const rows = await db.auditEvent.findMany({
    where: {
      organizationId: viewer.organizationId,
      // Under the organization scope, never beside it: a malformed or forged cursor must not be
      // able to reach another organization's log, so it only ever narrows this one.
      ...(cursor
        ? backwards
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
        : {}),
    },
    // Both columns, in the order the index stores them. Sorting by `createdAt` alone would leave
    // ties in whatever order the scan produced, and a cursor into an unstable order is not one.
    //
    // Ascending when walking backwards, so the page taken is the hundred *nearest* the cursor
    // rather than the hundred oldest in the log. It is reversed below for display.
    orderBy: backwards
      ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }],
    // One more than a page, purely to learn whether there is another one in this direction.
    take: AUDIT_PAGE_SIZE + 1,
  });

  const more = rows.length > AUDIT_PAGE_SIZE;
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  // Newest first, whichever direction the query ran in.
  const ordered = backwards ? [...page].reverse() : page;

  const newest = ordered[0];
  const oldest = ordered[ordered.length - 1];

  /*
   * Which arrows to offer, without a second query.
   *
   * `take + 1` only ever answers for the direction the query ran in. The other direction is
   * answered by how we got here: arriving via `before` means there are newer entries, because we
   * were just looking at them. Walking back with `after` and finding no further page means the top
   * of the log, so the newer arrow goes away — the page may be short, which is the honest shape of
   * "there were only forty newer than that one".
   */
  const hasNewer = backwards ? more : cursor !== null;
  const hasOlder = backwards ? true : more;

  return {
    entries: ordered.map((row) => ({
      id: row.id,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      action: row.action,
      targetLabel: row.targetLabel,
      metadata: (row.metadata ?? null) as Record<string, unknown> | null,
      createdAt: row.createdAt,
    })),
    ...(hasNewer && newest ? { newerCursor: formatCursor(newest) } : {}),
    ...(hasOlder && oldest ? { olderCursor: formatCursor(oldest) } : {}),
  };
}

/**
 * `<epoch millis>.<id>`.
 *
 * Millis and not an ISO string because the column is `TIMESTAMP(3)`: a millisecond is the finest
 * distinction it can hold, so this round-trips exactly rather than nearly.
 */
function formatCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.getTime()}.${row.id}`;
}

/**
 * Anything unreadable is no cursor at all.
 *
 * A cursor arrives in the URL, so it is user input and half of them will be truncated by a chat
 * client or edited by hand. Showing the first page is the right answer to a broken one — the
 * alternative is an error page for what is, to the person reading it, a stale link.
 */
function parseCursor(
  raw: string | undefined,
): { createdAt: Date; id: string } | null {
  if (!raw) return null;

  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;

  const millis = Number(raw.slice(0, dot));
  if (!Number.isSafeInteger(millis) || millis < 0) return null;

  return { createdAt: new Date(millis), id: raw.slice(dot + 1) };
}
