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
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type ListObjectsV2CommandOutput,
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

/** What S3 accepts in one DeleteObjects call. */
const DELETE_BATCH = 1_000;

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
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status !== 404) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      return 'created';
    }
  }

  async put(
    key: string,
    body: Buffer,
    options: PutOptions = {},
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: body.byteLength,
        ...(options.contentType ? { ContentType: options.contentType } : {}),
        ...(options.contentEncoding
          ? { ContentEncoding: options.contentEncoding }
          : {}),
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
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
      bytes.length >= 2 &&
      bytes[0] === GZIP_MAGIC[0] &&
      bytes[1] === GZIP_MAGIC[1];
    return gzipped ? gunzipSync(bytes) : bytes;
  }

  /**
   * Deletes objects, in batches of the thousand S3 allows per call.
   *
   * Deleting something that is not there is a success, not an error — which is what makes this
   * safe to retry. Retention runs on a schedule and can be interrupted at any point; a second pass
   * over keys the first pass already removed has to be a no-op rather than a failure that stops
   * the sweep.
   *
   * Returns how many keys were sent, not how many existed. S3 does not distinguish, and a count
   * that pretended to would be a number nobody could trust.
   */
  async deleteMany(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) return 0;

    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const batch = keys.slice(i, i + DELETE_BATCH);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            // Errors still come back; `Quiet` only suppresses the per-key success entries, which
            // for a thousand keys is a response nobody reads.
            Quiet: true,
          },
        }),
      );
    }

    return keys.length;
  }

  /**
   * Every key under a prefix, following pagination.
   *
   * Used by retention to find OTLP bodies, which are named with a ULID nothing records — the
   * database knows a span's trace but never which raw batch it arrived in. For those the prefix
   * *is* the index, which is why the day is in the key.
   *
   * `limit` bounds the walk. A bucket with a million objects under one prefix should slow a
   * scheduled sweep down, not exhaust its heap.
   */
  async listPrefix(prefix: string, limit = 10_000): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;

    do {
      const page: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: Math.min(1_000, limit - keys.length),
        }),
      );

      for (const object of page.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }

      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token && keys.length < limit);

    return keys;
  }
}
