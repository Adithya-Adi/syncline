import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
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
 * Sign-up is open only while the instance has no users.
 *
 * `disableSignUp` cannot express this: it is read once when the config is built, and the answer
 * changes the moment somebody registers. Enforcing it here rather than on the sign-up page means
 * the rule holds for anyone calling the endpoint directly, which is the only version of the rule
 * worth having.
 */
async function assertInstanceUnclaimed(): Promise<void> {
  const existing = await db.user.count();
  if (existing > 0) {
    throw new APIError('FORBIDDEN', {
      message:
        'This Syncline instance already has an owner. Ask them for an invitation rather than signing up.',
    });
  }
}

/**
 * The first user takes ownership of the instance.
 *
 * The migration that introduced multi-tenancy parked existing projects in an organization with no
 * members, because inventing a user row nobody can log in as would have been worse. This is where
 * that organization gets its owner. `upsert` covers the fresh-install case, where the migration
 * had no projects to adopt and so created nothing.
 */
async function claimInstance(userId: string): Promise<void> {
  const organizationId = DEFAULT_ORGANIZATION_ID;

  await db.organization.upsert({
    where: { id: organizationId },
    create: {
      id: organizationId,
      name: 'Default',
      slug: 'default',
      createdAt: new Date(),
    },
    update: {},
  });

  await db.member.create({
    data: {
      id: randomUUID(),
      organizationId,
      userId,
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
        before: async (user) => {
          await assertInstanceUnclaimed();
          return { data: user };
        },
        after: async (user) => {
          await claimInstance(user.id);
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

/** True while nobody has claimed this instance, which is what the sign-up page keys off. */
export async function isInstanceUnclaimed(): Promise<boolean> {
  return (await db.user.count()) === 0;
}
