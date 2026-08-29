/**
 * Creates a development project and prints its keys.
 *
 * The secret key is shown exactly once, here, because only its hash is stored. Re-run to mint a
 * second project; this does not overwrite an existing one.
 */

import 'dotenv/config';
import { createPrismaClientFromEnv } from '../src/lib/client.js';
import { hashSecretKey, newPublicKey, newSecretKey } from '../src/lib/keys.js';

async function main() {
  const prisma = createPrismaClientFromEnv();

  const publicKey = newPublicKey();
  const secretKey = newSecretKey();

  const project = await prisma.project.create({
    data: {
      name: process.env['SEED_PROJECT_NAME'] ?? 'Local development',
      publicKey,
      secretKeyHash: hashSecretKey(secretKey),
      origins: ['http://localhost:3000', 'http://localhost:4200'],
    },
  });

  console.log('');
  console.log(`  project    ${project.name}  (${project.id})`);
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
