import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { PayloadTooLargeException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { readBody } from './read-body.js';

function request(chunks: Buffer[]): IncomingMessage {
  const stream = Readable.from(chunks) as unknown as IncomingMessage;
  // Readable.from has no destroy semantics we care about here; readBody only needs it callable.
  stream.destroy = stream.destroy ?? (() => undefined);
  return stream;
}

describe('readBody', () => {
  it('returns the bytes exactly as they arrived', async () => {
    const payload = Buffer.from('{"hello":"world"}');
    const body = await readBody(request([payload]), 1024);
    expect(body.bytes.equals(payload)).toBe(true);
  });

  it('reassembles a body split across chunks', async () => {
    const body = await readBody(request([Buffer.from('{"a":'), Buffer.from('1}')]), 1024);
    expect(body.bytes.toString()).toBe('{"a":1}');
  });

  it('detects gzip from the payload, not from a header we were told about', async () => {
    const body = await readBody(request([gzipSync(Buffer.from('{"a":1}'))]), 1024);
    expect(body.gzipped).toBe(true);
  });

  it('does not mistake plain JSON for gzip', async () => {
    const body = await readBody(request([Buffer.from('{"a":1}')]), 1024);
    expect(body.gzipped).toBe(false);
  });

  it('does not inflate the payload — the worker does that, off the connection', async () => {
    const raw = Buffer.from('{"a":1}');
    const body = await readBody(request([gzipSync(raw)]), 1024);
    expect(body.bytes.equals(raw)).toBe(false);
    expect(body.bytes.length).toBeGreaterThan(0);
  });

  it('rejects a body over the limit', async () => {
    const big = Buffer.alloc(200, 0x61);
    await expect(readBody(request([big]), 100)).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('stops reading without destroying the socket, so the 413 can be written', async () => {
    const chunks = Array.from({ length: 10 }, () => Buffer.alloc(50, 0x61));
    const stream = Readable.from(chunks) as unknown as IncomingMessage;
    const destroy = jest.fn();
    stream.destroy = destroy as unknown as IncomingMessage['destroy'];

    await expect(readBody(stream, 100)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('handles an empty body without throwing, leaving the caller to reject it', async () => {
    const body = await readBody(request([]), 1024);
    expect(body.bytes.length).toBe(0);
    expect(body.gzipped).toBe(false);
  });
});
