import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CONFIG, type AppConfig } from '../config/config.js';

/**
 * Object storage for raw ingest bodies.
 *
 * Postgres stores the index; this stores the film. A five-minute session is tens of megabytes of
 * DOM mutations, which has no business in a relational database.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      // MinIO addresses buckets by path; most cloud providers use virtual-host style.
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  /**
   * Fails at boot if storage is unreachable, and creates the bucket if it is merely absent.
   *
   * Discovering a misconfigured bucket on the first ingest request means losing that session; the
   * cost of finding out here is one round trip at startup.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`bucket "${this.bucket}" ready`);
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== 404) throw error;

      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`bucket "${this.bucket}" created`);
    }
  }

  async put(
    key: string,
    body: Buffer,
    options: { contentType?: string; contentEncoding?: string } = {}
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: body.byteLength,
        ...(options.contentType ? { ContentType: options.contentType } : {}),
        ...(options.contentEncoding ? { ContentEncoding: options.contentEncoding } : {}),
      })
    );
  }
}
