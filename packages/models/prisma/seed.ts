/**
 * Creates a development project and prints its keys.
 *
 * The secret key is shown exactly once, here, because only its hash is stored. Re-run to mint a
 * second project; this does not overwrite an existing one.
 */

import 'dotenv/config';
import { createPrismaClientFromEnv } from '../src/lib/client.js';
import { hashSecretKey, newPublicKey, newSecretKey } from '../src/lib/keys.js';

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
   * Every project belongs to an organization, so the seed has to pick one.
   *
   * It joins whichever organization already exists — on a machine where someone has signed up,
   * that is theirs, and a seeded project they cannot see would be a puzzle rather than a
   * convenience. Only on an untouched database does it create one, and it uses the same id the
   * multi-tenancy migration used so the first account to register adopts both.
   */
  const existing = await prisma.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });

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

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
