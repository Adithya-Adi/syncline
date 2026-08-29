import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { ObjectStore } from './object-store.js';

function storeReturning(bytes: Buffer) {
  const store = new ObjectStore({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'syncline',
    accessKeyId: 'k',
    secretAccessKey: 's',
    forcePathStyle: true,
  });
  vi.spyOn(store, 'get').mockResolvedValue(bytes);
  return store;
}

describe('getMaybeGzipped', () => {
  it('inflates a gzipped object', async () => {
    const store = storeReturning(gzipSync(Buffer.from('{"a":1}')));
    expect((await store.getMaybeGzipped('k')).toString()).toBe('{"a":1}');
  });

  it('passes through an object that was never compressed', async () => {
    const store = storeReturning(Buffer.from('{"a":1}'));
    expect((await store.getMaybeGzipped('k')).toString()).toBe('{"a":1}');
  });

  it('decides from the bytes, not the key or a stored header', async () => {
    // Stored under a .json.gz key by the API, but sent uncompressed by hand with curl.
    const store = storeReturning(Buffer.from('plain'));
    await expect(store.getMaybeGzipped('sessions/p/s/0.json.gz')).resolves.toEqual(
      Buffer.from('plain')
    );
  });

  it('does not mistake a short body for gzip', async () => {
    const store = storeReturning(Buffer.from([0x1f]));
    expect((await store.getMaybeGzipped('k')).length).toBe(1);
  });
});
