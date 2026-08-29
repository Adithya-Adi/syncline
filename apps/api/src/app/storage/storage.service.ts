import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ObjectStore, type PutOptions } from '@syncline/storage';
import { CONFIG, type AppConfig } from '../config/config.js';

/**
 * Object storage for raw ingest bodies, as a Nest provider.
 *
 * The client itself lives in @syncline/storage because apps/worker reads back exactly what this
 * writes. Sharing one implementation is what keeps the two from drifting on bucket, credentials
 * or addressing style — a mismatch there shows up as "the object is not there" at the far end of a
 * queue, which is a miserable thing to trace back.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly store: ObjectStore;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.store = new ObjectStore({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
  }

  /**
   * Fails at boot if storage is unreachable, and creates the bucket if it is merely absent.
   *
   * Discovering a misconfigured bucket on the first ingest request means losing that session; the
   * cost of finding out here is one round trip at startup.
   */
  async onModuleInit(): Promise<void> {
    const state = await this.store.ensureBucket();
    this.logger.log(`bucket "${this.store.bucket}" ${state}`);
  }

  async put(key: string, body: Buffer, options: PutOptions = {}): Promise<void> {
    await this.store.put(key, body, options);
  }

  /** Returns the stored bytes untouched, still compressed if that is how they arrived. */
  async get(key: string): Promise<Buffer> {
    return this.store.get(key);
  }
}
