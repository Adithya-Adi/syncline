'use server';

import { revalidatePath } from 'next/cache';
import { isReservedKey } from '@syncline/models';
import { requirePermission } from './permissions';
import { db } from './db';
import { projectForViewer, requireViewer } from './session';

/**
 * The search vocabulary a project has accumulated, and what can be done about it.
 *
 * This is the settings half of open-vocabulary indexing. Keys are discovered rather than declared —
 * whatever `setContext` sends becomes searchable immediately — and that trade only holds if there
 * is somewhere to undo it: a key nobody meant to send, a value that turned out to be personal, a
 * name that was a mistake.
 *
 * Every action re-resolves the viewer and scopes by their organization rather than trusting the
 * project id in the form. A server action is a public endpoint wearing a function's clothes.
 */

export interface AttributeKeySummary {
  key: string;
  /** `builtin` for what Syncline derives, `custom` for what the application sent. */
  source: string;
  indexed: boolean;
  /** How many (session, value) rows exist. What "delete values" would remove. */
  values: number;
  firstSeenMs: number;
  lastSeenMs: number;
}

/**
 * Every key the project has been seen using, with how much is stored under each.
 *
 * Two queries rather than one per key: the vocabulary, and one grouped count over the attribute
 * rows. The count is of rows, not distinct values — a distinct count over a high-cardinality key is
 * a full scan of that key's index, and this page is not worth one.
 */
export async function projectAttributeKeys(
  projectId: string,
): Promise<AttributeKeySummary[]> {
  const viewer = await requireViewer();
  const project = await projectForViewer(viewer, projectId);
  if (!project) return [];

  const [keys, counts] = await Promise.all([
    db.projectAttributeKey.findMany({
      where: { projectId: project.id },
      orderBy: [{ source: 'asc' }, { key: 'asc' }],
    }),
    db.sessionAttribute.groupBy({
      by: ['key'],
      where: { projectId: project.id },
      _count: { _all: true },
    }),
  ]);

  const byKey = new Map(counts.map((row) => [row.key, row._count._all]));

  return keys.map((row) => ({
    key: row.key,
    source: row.source,
    indexed: row.indexed,
    values: byKey.get(row.key) ?? 0,
    firstSeenMs: row.firstSeenAt.getTime(),
    lastSeenMs: row.lastSeenAt.getTime(),
  }));
}

/**
 * Resolves a key the form named, or throws.
 *
 * Built-in keys are refused: they are what the flow, the identity and the browser columns are
 * indexed under, so switching one off would quietly break `path:` and `user:` for everyone in the
 * organization — and it would not even remove the data, which is on the session either way.
 */
async function resolveKey(
  formData: FormData,
): Promise<{ projectId: string; key: string }> {
  const projectId = String(formData.get('projectId') ?? '');
  const key = String(formData.get('key') ?? '');

  const viewer = await requireViewer();
  requirePermission(viewer, 'data:manage');

  const project = await projectForViewer(viewer, projectId);
  if (!project) throw new Error('No such project.');
  if (!key) throw new Error('No key given.');
  if (isReservedKey(key)) throw new Error('Built-in keys cannot be changed.');

  return { projectId: project.id, key };
}

/**
 * Stops or resumes indexing a key.
 *
 * Only affects what is written from here on. Values already stored stay searchable until they are
 * deleted, which is a separate and more destructive act — conflating the two would mean someone
 * clicking "stop indexing" to tidy up their filter list silently destroyed a month of data.
 */
export async function setAttributeKeyIndexed(
  formData: FormData,
): Promise<void> {
  const { projectId, key } = await resolveKey(formData);
  const indexed = formData.get('indexed') === 'true';

  await db.projectAttributeKey.updateMany({
    where: { projectId, key },
    data: { indexed },
  });

  revalidatePath(`/projects/${projectId}`);
}

/**
 * Removes everything stored under a key, and stops it coming back.
 *
 * Three tables, because a value lives in three places: the index a search reads, the raw context
 * the index is derived from, and the vocabulary that lists the key. Deleting only the index would
 * put every value back on the next chunk of every live session, which is the opposite of what
 * somebody deleting a key wants.
 *
 * Indexing is switched off in the same act rather than left on. The reason to delete a key is
 * almost always that it should never have been sent, and a delete that quietly refills is not a
 * delete — the button says so.
 */
export async function deleteAttributeKey(formData: FormData): Promise<void> {
  const { projectId, key } = await resolveKey(formData);

  await db.$transaction([
    db.sessionAttribute.deleteMany({ where: { projectId, key } }),
    // Scoped through the session, since context rows carry no project of their own.
    db.sessionContext.deleteMany({ where: { key, session: { projectId } } }),
    db.projectAttributeKey.updateMany({
      where: { projectId, key },
      data: { indexed: false },
    }),
  ]);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/recordings`);
}
