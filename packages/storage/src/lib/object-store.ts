/**
 * S3-compatible object storage.
 *
 * Shared by apps/api (which writes ingest bodies) and apps/worker (which reads them back). It
 * lives in one package so the two cannot drift on bucket, credentials, or addressing style — a
 * mismatch there produces "the object is not there" at the far end of a queue, which is a
 * miserable thing to trace back.
 */

import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { gunzipSync } from 'node:zlib';

export interface ObjectStoreOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO addresses buckets by path; most cloud providers use virtual-host style. */
  forcePathStyle: boolean;
}

export interface PutOptions {
  contentType?: string;
  contentEncoding?: string;
}

const GZIP_MAGIC = [0x1f, 0x8b];

export class ObjectStore {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(options: ObjectStoreOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  /**
   * Confirms the bucket exists, creating it if it merely does not.
   *
   * Called at boot: discovering a misconfigured bucket on the first ingest request means losing
   * that session, and the cost of finding out here is one round trip.
   */
  async ensureBucket(): Promise<'existing' | 'created'> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return 'existing';
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== 404) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      return 'created';
    }
  }

  async put(key: string, body: Buffer, options: PutOptions = {}): Promise<void> {
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

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    if (!result.Body) throw new Error(`object ${key} has no body`);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  /**
   * Reads an object and inflates it if it is gzipped.
   *
   * Compression is detected from the bytes rather than from stored metadata: the API records
   * `Content-Encoding` when it can tell, but a body that arrived uncompressed is stored under the
   * same `.json.gz` key, and trusting the key or the header would fail on exactly the payloads a
   * human sent by hand while debugging.
   */
  async getMaybeGzipped(key: string): Promise<Buffer> {
    const bytes = await this.get(key);
    const gzipped =
      bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
    return gzipped ? gunzipSync(bytes) : bytes;
  }
}
