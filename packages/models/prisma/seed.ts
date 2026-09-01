/**
 * Creates a development project and prints its keys.
 *
 * The secret key is shown exactly once, here, because only its hash is stored. Re-run to mint a
 * second project; this does not overwrite an existing one.
 */

import 'dotenv/config';
import { createPrismaClientFromEnv } from '../src/lib/client.js';
import { hashSecretKey, newPublicKey, newSecretKey } from '../src/lib/keys.js';
import { seedDemoRecording } from './demo.js';

const DEFAULT_ORGANIZATION_ID = 'org_default';

/** Origins a locally developed app is likely to be served from, including the example storefront. */
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4200',
  'http://localhost:4321',
];

async function main() {
  const prisma = createPrismaClientFromEnv();

  /**
   * Every project belongs to an organization, so the seed has to pick one — and picking wrong is
   * not a harmless default. A project seeded into an organization the developer is not a member of
   * ingests recordings perfectly well and shows none of them in their dashboard, which looks like a
   * broken pipeline rather than a misfiled project.
   *
   * So: the newest organization that somebody actually belongs to. An organization with no members
   * is invisible to everyone, and on a machine where several people or several sign-ups have
   * accumulated, the most recent one is the one being worked in. `SEED_ORGANIZATION` overrides it
   * by id or slug when that guess is wrong.
   */
  const requested = process.env['SEED_ORGANIZATION'];

  const existing = requested
    ? await prisma.organization.findFirst({
        where: { OR: [{ id: requested }, { slug: requested }] },
        select: { id: true, name: true },
      })
    : await prisma.organization.findFirst({
        where: { members: { some: {} } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true },
      });

  if (requested && !existing) {
    throw new Error(
      `SEED_ORGANIZATION=${requested} matched no organization by id or slug.`,
    );
  }

  const organization =
    existing ??
    (await prisma.organization.create({
      data: {
        id: DEFAULT_ORGANIZATION_ID,
        name: 'Default',
        slug: 'default',
        createdAt: new Date(),
      },
      select: { id: true, name: true },
    }));

  const publicKey = newPublicKey();
  const secretKey = newSecretKey();

  const project = await prisma.project.create({
    data: {
      name: process.env['SEED_PROJECT_NAME'] ?? 'Local development',
      organizationId: organization.id,
      publicKey,
      secretKeyHash: hashSecretKey(secretKey),
      origins: DEV_ORIGINS,
    },
  });

  console.log('');
  console.log(`  project    ${project.name}  (${project.id})`);
  console.log(`  org        ${organization.name}  (${organization.id})`);
  console.log(`  origins    ${project.origins.join(', ')}`);
  console.log('');
  console.log(`  public key ${publicKey}`);
  console.log(`  secret key ${secretKey}`);
  console.log('');
  console.log('  The secret key is not recoverable — only its hash is stored.');
  console.log('');

  /**
   * A recording to look at before there is one of your own.
   *
   * Installed after the keys are printed, and never allowed to throw. The secret key is shown
   * exactly once and cannot be recovered, so losing it to a MinIO container nobody started — or to
   * anything else that goes wrong down here — would be a bad trade for a convenience feature.
   * `SEED_DEMO=false` turns it off for anyone who wants an empty project.
   */
  const demo =
    process.env['SEED_DEMO'] === 'false'
      ? 'SEED_DEMO=false'
      : await seedDemoRecording(prisma, project.id).catch(
          (error: unknown) => `${(error as Error).message}`,
        );

  if (typeof demo === 'string') {
    console.log(`  demo       skipped (${demo})`);
    console.log('');
  } else {
    console.log(
      `  demo       ${Math.round(demo.durationMs / 1000)}s across ${demo.pageCount} pages, ` +
        `${demo.requestCount} requests, ${demo.spanCount} spans`,
    );
    console.log(`             http://localhost:3000/s/${demo.sessionId}`);
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
