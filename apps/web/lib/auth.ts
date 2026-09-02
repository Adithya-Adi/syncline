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
 * Registration is open, and a new account belongs to nothing until it says otherwise.
 *
 * It used to be given an organization named after whoever registered. That was the wrong default
 * twice over: the name is a guess at what someone wants their workspace called, and there is no
 * screen anywhere that lets them correct it — so the guess was permanent. Naming it is now the
 * first thing the dashboard asks for, which takes one screen and produces a name somebody chose.
 *
 * The isolation that lets registration stay open is unchanged: a new account sees nothing until it
 * creates an organization or accepts an invitation into one.
 */

/**
 * Adopts the seeded organization, if one is sitting there with nobody in it.
 *
 * The one case where an account is given an organization rather than asked for one, and it is not
 * a guess — it is a handover. `pnpm db:seed` creates a project before anyone has registered, and
 * the multi-tenancy migration did the same for projects that predated organizations. Both park it
 * under `org_default` with no members, which makes it invisible to everyone: whoever registers
 * first takes it, along with the demo recording that is the entire point of having seeded.
 *
 * Narrow on purpose. It fires only for that id, only while it has no members, and on a fresh
 * install where nobody ran the seed it never fires at all.
 */
async function adoptSeededOrganization(userId: string): Promise<void> {
  const orphaned = await db.organization.findFirst({
    where: { id: DEFAULT_ORGANIZATION_ID, members: { none: {} } },
    select: { id: true },
  });

  if (!orphaned) return;

  await db.member.create({
    data: {
      id: randomUUID(),
      organizationId: orphaned.id,
      userId,
      role: 'owner',
      createdAt: new Date(),
    },
  });
}

/**
 * The organization a new session should open in.
 *
 * Where someone left off, when they still belong there — otherwise their earliest membership, and
 * nothing at all when they belong nowhere. The membership check is not a formality: being removed
 * from the organization you were last in is exactly when a remembered id goes stale, and honouring
 * it then would strand you outside the ones you still belong to.
 */
async function openingOrganizationId(
  userId: string,
): Promise<string | undefined> {
  const [preference, memberships] = await Promise.all([
    db.userPreference.findUnique({
      where: { userId },
      select: { lastOrganizationId: true },
    }),
    db.member.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    }),
  ]);

  const remembered = preference?.lastOrganizationId;
  const stillAMember = memberships.some(
    (membership) => membership.organizationId === remembered,
  );

  return stillAMember && remembered
    ? remembered
    : memberships[0]?.organizationId;
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
          await adoptSeededOrganization(user.id);
        },
      },
    },

    /**
     * Point a new session at an organization straight away.
     *
     * Better Auth leaves `activeOrganizationId` null until something calls `setActive`, and every
     * organization mutation — invite, cancel an invitation, re-role, remove — falls back to it when
     * the caller does not name an organization. A null one comes back as "Organization not found",
     * which reads as a missing tenant rather than an unset pointer on the session.
     *
     * So it is chosen here, once, at sign-in: where they left off if they still belong there, and
     * their earliest membership otherwise. Switching afterwards calls `setActive`, which overwrites
     * this and is remembered for next time — see `rememberOrganization` in session.ts.
     *
     * Someone who belongs nowhere is left null on purpose. There is nothing to point at, and the
     * dashboard sends them to create an organization rather than rendering an empty one.
     */
    session: {
      create: {
        before: async (session) => {
          if (session.activeOrganizationId) return;

          const organizationId = await openingOrganizationId(session.userId);
          if (!organizationId) return;

          return {
            data: { ...session, activeOrganizationId: organizationId },
          };
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
