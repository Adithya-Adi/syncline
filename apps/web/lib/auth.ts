import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins/organization';
import { nextCookies } from 'better-auth/next-js';
import { randomUUID } from 'node:crypto';
import { db } from './db';

/**
 * Authentication for the Syncline dashboard.
 *
 * Deliberately lives in the web app rather than the API. The API stays machine-to-machine and
 * key-authenticated: it never has to understand a user session, and a browser never holds an
 * ingest key. The web app is the only thing that knows about people.
 *
 * Email and password only. A self-hosted install should not need an OAuth app registration or a
 * working SMTP server before anyone can log in for the first time. Social providers can be added
 * later without a schema change — the account table already accommodates them.
 */

const DEFAULT_ORGANIZATION_ID = 'org_default';

/**
 * Registration is open, and every account lands in an organization of its own.
 *
 * The isolation is the reason it can be open at all: a new account sees an empty dashboard, never
 * anybody else's recordings. Sharing happens by invitation into an existing organization, which is
 * an explicit act by someone who is already a member.
 */

/** URL-safe, stable, and short enough to read in an address bar. */
function slugify(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length > 0 ? slug : 'workspace';
}

/**
 * Finds a free slug near the one asked for.
 *
 * The column is unique, so a second "Acme" has to become something else, and a suffix is less
 * surprising than a rejected sign-up. Bounded rather than looping forever: after a few collisions
 * the random suffix is doing the work, not the base.
 */
async function freeSlug(base: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate =
      attempt === 0 ? base : `${base}-${randomUUID().slice(0, 6)}`;
    const taken = await db.organization.findUnique({
      where: { slug: candidate },
      select: { slug: true },
    });
    if (!taken) return candidate;
  }
  return `${base}-${randomUUID()}`;
}

/**
 * Gives a new account somewhere to be.
 *
 * One special case, and it is a migration artifact rather than a rule: the multi-tenancy migration
 * parked pre-existing projects in an organization with no members, because inventing a user row
 * nobody can log in as would have been worse. Whoever registers first adopts it, along with those
 * projects. Everybody else — and everybody on a fresh install, where that organization was never
 * created — gets a new one.
 */
async function provisionOrganization(user: {
  id: string;
  name?: string | null;
  email: string;
}): Promise<void> {
  const orphaned = await db.organization.findFirst({
    where: { id: DEFAULT_ORGANIZATION_ID, members: { none: {} } },
    select: { id: true },
  });

  const organizationId = orphaned?.id ?? randomUUID();

  if (!orphaned) {
    const name = user.name?.trim() || user.email.split('@')[0] || 'Workspace';
    await db.organization.create({
      data: {
        id: organizationId,
        name,
        slug: await freeSlug(slugify(name)),
        createdAt: new Date(),
      },
    });
  }

  await db.member.create({
    data: {
      id: randomUUID(),
      organizationId,
      userId: user.id,
      role: 'owner',
      createdAt: new Date(),
    },
  });
}

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),

  emailAndPassword: {
    enabled: true,
    // Nothing can send mail on a fresh self-hosted install, so requiring verification would lock
    // the first user out of their own instance. Revisit once SMTP is configurable.
    requireEmailVerification: false,
    minPasswordLength: 10,
  },

  /**
   * Better Auth's session table would collide with ours, which means a recording. Renaming a
   * domain model across six packages to accommodate a library is the wrong trade, so the library's
   * model is the one that moves.
   */
  session: {
    modelName: 'AuthSession',
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await provisionOrganization(user);
        },
      },
    },
  },

  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 10,
    }),
    // Must come last: it writes Better Auth's cookies through Next's cookie API.
    nextCookies(),
  ],

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
});

export type Auth = typeof auth;
