'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { hashSecretKey, newPublicKey, newSecretKey } from '@syncline/models';
import { db } from './db';
import { projectForViewer, requireViewer } from './session';

/**
 * Project and API key management.
 *
 * Every action re-resolves the viewer rather than trusting an id from the form. A server action is
 * a public endpoint wearing a function's clothes: anything it accepts is attacker-controlled, and
 * the organization has to come from the session every time.
 */

/** Where a freshly minted secret is stashed so the page that redirects can show it exactly once. */
const revealed = new Map<string, { secret: string; expiresAt: number }>();
const REVEAL_TTL_MS = 5 * 60 * 1000;

function stashSecret(projectId: string, secret: string): void {
  revealed.set(projectId, { secret, expiresAt: Date.now() + REVEAL_TTL_MS });
}

/**
 * Returns a just-created secret once, then forgets it.
 *
 * Held in memory rather than the database because storing it would defeat the point of hashing:
 * the whole reason a secret is shown once is that we do not keep a copy. A process restart losing
 * it is correct behaviour, and the operator can rotate.
 */
export async function takeRevealedSecret(
  projectId: string,
): Promise<string | null> {
  const entry = revealed.get(projectId);
  if (!entry) return null;

  revealed.delete(projectId);
  if (entry.expiresAt < Date.now()) return null;

  return entry.secret;
}

function parseOrigins(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          try {
            // Normalized to an origin so a pasted full URL cannot silently fail to match later.
            return new URL(value).origin;
          } catch {
            return value;
          }
        }),
    ),
  ];
}

export async function createProject(formData: FormData): Promise<void> {
  const viewer = await requireViewer();

  const name = String(formData.get('name') ?? '').trim();
  const origins = parseOrigins(String(formData.get('origins') ?? ''));

  if (!name) throw new Error('A project needs a name.');

  const secretKey = newSecretKey();

  const project = await db.project.create({
    data: {
      name,
      organizationId: viewer.organizationId,
      publicKey: newPublicKey(),
      secretKeyHash: hashSecretKey(secretKey),
      origins,
    },
  });

  stashSecret(project.id, secretKey);

  revalidatePath('/projects');
  redirect(`/projects/${project.id}?created=1`);
}

export async function rotateSecretKey(formData: FormData): Promise<void> {
  const viewer = await requireViewer();
  const projectId = String(formData.get('projectId') ?? '');

  const project = await projectForViewer(viewer, projectId);
  if (!project) throw new Error('No such project.');

  const secretKey = newSecretKey();
  await db.project.update({
    where: { id: project.id },
    data: { secretKeyHash: hashSecretKey(secretKey) },
  });

  stashSecret(project.id, secretKey);

  revalidatePath(`/projects/${project.id}`);
  redirect(`/projects/${project.id}?rotated=secret`);
}

/**
 * Rotating the public key stops every browser currently running the old one.
 *
 * That is the point — it is how you revoke a key that leaked into somewhere it should not be — but
 * it means recordings stop until the new key is deployed, so the UI says so before you click.
 */
export async function rotatePublicKey(formData: FormData): Promise<void> {
  const viewer = await requireViewer();
  const projectId = String(formData.get('projectId') ?? '');

  const project = await projectForViewer(viewer, projectId);
  if (!project) throw new Error('No such project.');

  await db.project.update({
    where: { id: project.id },
    data: { publicKey: newPublicKey() },
  });

  revalidatePath(`/projects/${project.id}`);
  redirect(`/projects/${project.id}?rotated=public`);
}

export async function updateProject(formData: FormData): Promise<void> {
  const viewer = await requireViewer();
  const projectId = String(formData.get('projectId') ?? '');

  const project = await projectForViewer(viewer, projectId);
  if (!project) throw new Error('No such project.');

  const name = String(formData.get('name') ?? '').trim();
  const origins = parseOrigins(String(formData.get('origins') ?? ''));

  if (!name) throw new Error('A project needs a name.');

  await db.project.update({
    where: { id: project.id },
    data: { name, origins },
  });

  revalidatePath(`/projects/${project.id}`);
  redirect(`/projects/${project.id}?saved=1`);
}
