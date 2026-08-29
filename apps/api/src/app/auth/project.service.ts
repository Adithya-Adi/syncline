import { Injectable } from '@nestjs/common';
import { hashSecretKey } from '@syncline/models';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ResolvedProject {
  id: string;
  name: string;
  origins: string[];
}

/** Ingest runs one of these lookups per chunk, so the result is cached briefly. */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  project: ResolvedProject | null;
  expiresAt: number;
}

@Injectable()
export class ProjectService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /** The key is public by design, so it is matched directly against a unique index. */
  async byPublicKey(publicKey: string): Promise<ResolvedProject | null> {
    return this.resolve(`pk:${publicKey}`, () =>
      this.prisma.client.project.findUnique({
        where: { publicKey },
        select: { id: true, name: true, origins: true },
      })
    );
  }

  /**
   * Only the hash is stored, so the lookup *is* the comparison — there is no plaintext secret in
   * the database to compare against, and no branch that could leak timing.
   */
  async bySecretKey(secretKey: string): Promise<ResolvedProject | null> {
    const hash = hashSecretKey(secretKey);
    return this.resolve(`sk:${hash}`, () =>
      this.prisma.client.project.findUnique({
        where: { secretKeyHash: hash },
        select: { id: true, name: true, origins: true },
      })
    );
  }

  /** Negative results are cached too, so a key sprayed at the endpoint costs one query, not many. */
  private async resolve(
    cacheKey: string,
    query: () => Promise<ResolvedProject | null>
  ): Promise<ResolvedProject | null> {
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.project;

    const project = await query();
    this.cache.set(cacheKey, { project, expiresAt: now + CACHE_TTL_MS });
    return project;
  }

  /** Exposed for tests and for the eventual "keys rotated" invalidation path. */
  clearCache(): void {
    this.cache.clear();
  }
}
