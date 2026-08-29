import { PayloadTooLargeException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

/** gzip's magic number. Present whether the SDK compressed or a curl user did not. */
const GZIP_MAGIC = [0x1f, 0x8b];

export interface RawBody {
  bytes: Buffer;
  /** True when the payload is gzipped, decided by content rather than by a header we were told. */
  gzipped: boolean;
}

/**
 * Reads a request body with a hard byte ceiling.
 *
 * Nest's body parser is disabled for the whole application, so this receives the untouched stream.
 * That is deliberate on two counts: the API stores the compressed bytes exactly as they arrived
 * rather than inflating and recompressing them, and it never inflates attacker-controlled gzip on
 * an HTTP connection — a body that expands to gigabytes is the worker's problem, where it costs a
 * queue slot instead of the process.
 *
 * The limit is enforced as bytes arrive, not afterwards, so an oversized upload stops being read
 * rather than being buffered to completion and then rejected.
 */
export function readBody(req: IncomingMessage, limitBytes: number): Promise<RawBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const onData = (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;

      if (size > limitBytes) {
        settled = true;
        // Stop reading, but leave the socket alive. Destroying it here means the 413 has nowhere
        // to be written, and the client sees a dropped connection — or, if it sent
        // `Expect: 100-continue`, nothing but the interim 100. Node closes the connection itself
        // once the response goes out on a request that was never fully read.
        req.pause();
        req.removeListener('data', onData);
        reject(new PayloadTooLargeException(`body exceeds ${limitBytes} bytes`));
        return;
      }

      chunks.push(chunk);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(error);
    };

    req.on('data', onData);

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const bytes = Buffer.concat(chunks);
      resolve({
        bytes,
        gzipped: bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1],
      });
    });

    req.on('error', fail);
    req.on('aborted', () => fail(new Error('client aborted the upload')));
  });
}
