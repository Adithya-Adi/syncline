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

/** One page of the log, newest first. */
export async function recentAuditEvents(
  viewer: Viewer,
  limit = 100,
): Promise<AuditEntry[]> {
  const rows = await db.auditEvent.findMany({
    where: { organizationId: viewer.organizationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    actorName: row.actorName,
    actorEmail: row.actorEmail,
    action: row.action,
    targetLabel: row.targetLabel,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    createdAt: row.createdAt,
  }));
}
