import { describe, expect, it, vi } from 'vitest';
import { TRACEPARENT_HEADER, parseTraceparent } from '@syncline/protocol';
import { installFetchPatch, type TraceHooks } from './trace.js';

const PAGE_ORIGIN = 'https://app.acme.com';
const OPTIONS = { traceOrigins: [PAGE_ORIGIN], pageOrigin: PAGE_ORIGIN };

function harness(fetchImpl?: typeof fetch) {
  const calls: { url: string; headers: Headers }[] = [];

  const target = {
    fetch: (fetchImpl ??
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined)
        );
        calls.push({ url: input instanceof Request ? input.url : String(input), headers });
        return new Response('{}', { status: 200 });
      })) as typeof fetch,
  };

  const hooks: TraceHooks = { onStart: vi.fn(), onEnd: vi.fn() };
  return { target, hooks, calls };
}

describe('header injection', () => {
  it('adds a traceparent to an allowlisted request', async () => {
    const { target, hooks, calls } = harness();
    installFetchPatch(target, OPTIONS, hooks);

    await target.fetch(`${PAGE_ORIGIN}/api/checkout`, { method: 'POST' });

    const header = calls[0].headers.get(TRACEPARENT_HEADER);
    expect(header).toBeTruthy();
    expect(parseTraceparent(header as string)).toMatchObject({ version: '00' });
  });

  it('always marks the trace sampled, so a replay cannot lose its spans', async () => {
    const { target, hooks, calls } = harness();
    installFetchPatch(target, OPTIONS, hooks);

    await target.fetch(`${PAGE_ORIGIN}/api/checkout`);

    expect(parseTraceparent(calls[0].headers.get(TRACEPARENT_HEADER) as string)?.sampled).toBe(true);
  });

  it('never injects cross-origin, which would leak ids and break their preflight', async () => {
    const { target, hooks, calls } = harness();
    installFetchPatch(target, OPTIONS, hooks);

    await target.fetch('https://analytics.thirdparty.com/collect');

    expect(calls[0].headers.get(TRACEPARENT_HEADER)).toBeNull();
    expect(hooks.onStart).not.toHaveBeenCalled();
  });

  it('treats a relative URL as same-origin', async () => {
    const { target, hooks, calls } = harness();
    installFetchPatch(target, OPTIONS, hooks);

    await target.fetch('/api/checkout');

    expect(calls[0].headers.get(TRACEPARENT_HEADER)).toBeTruthy();
  });

  it('gives every request its own ids', async () => {
    const { target, hooks, calls } = harness();
    installFetchPatch(target, OPTIONS, hooks);

    await target.fetch('/a');
    await target.fetch('/b');

    const first = parseTraceparent(calls[0].headers.get(TRACEPARENT_HEADER) as string);
    const second = parseTraceparent(calls[1].headers.get(TRACEPARENT_HEADER) as string);
    expect(first?.traceId).not.toBe(second?.traceId);
  });

  it('sets the header on a Request without consuming its body', async () => {
    const { target, hooks } = harness();
    installFetchPatch(target, OPTIONS, hooks);

    const request = new Request(`${PAGE_ORIGIN}/api/checkout`, {
      method: 'POST',
      body: '{"cart":1}',
    });
    await target.fetch(request);

    expect(request.headers.get(TRACEPARENT_HEADER)).toBeTruthy();
    // Reconstructing the Request would have marked this true and broken any caller still reading it.
    expect(request.bodyUsed).toBe(false);
  });
});

describe('hooks', () => {
  it('reports the status the client actually saw', async () => {
    const { target, hooks } = harness(
      (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    );
    installFetchPatch(target, OPTIONS, hooks);

    await target.fetch('/api/checkout');

    expect(hooks.onEnd).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
  });

  it('closes the span with an error when the request throws, and rethrows', async () => {
    const { target, hooks } = harness(
      (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch
    );
    installFetchPatch(target, OPTIONS, hooks);

    await expect(target.fetch('/api/checkout')).rejects.toThrow('offline');
    expect(hooks.onEnd).toHaveBeenCalledWith(expect.objectContaining({ error: 'offline' }));
  });

  it('pairs start and end by span id', async () => {
    const { target, hooks } = harness();
    installFetchPatch(target, OPTIONS, hooks);

    await target.fetch('/api/checkout');

    const started = (hooks.onStart as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const ended = (hooks.onEnd as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ended.spanId).toBe(started.spanId);
  });

  it('records a sanitized URL, never the query values', async () => {
    const { target, hooks } = harness();
    installFetchPatch(target, OPTIONS, hooks);

    await target.fetch('/search?token=secret123&page=2');

    const started = (hooks.onStart as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(started.url).toBe(`${PAGE_ORIGIN}/search?token&page`);
    expect(started.url).not.toContain('secret123');
  });
});

describe('never breaking the page', () => {
  it('still performs the request when a hook throws', async () => {
    const { target, calls } = harness();
    installFetchPatch(target, OPTIONS, {
      onStart() {
        throw new Error('instrumentation is broken');
      },
      onEnd() {
        throw new Error('also broken');
      },
    });

    const response = await target.fetch('/api/checkout');

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('passes a strange input through without throwing', async () => {
    const { target, hooks, calls } = harness();
    installFetchPatch(target, OPTIONS, hooks);

    // Resolved against the page this is a valid same-origin path, so it is traced. What matters
    // is that nothing here throws into the caller.
    await expect(target.fetch('::::not a url::::')).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
    expect(hooks.onStart).toHaveBeenCalled();
  });

  it('does not trace a scheme that cannot carry a header', async () => {
    const { target, hooks } = harness();
    installFetchPatch(target, OPTIONS, hooks);

    await target.fetch('data:text/plain,hello');

    expect(hooks.onStart).not.toHaveBeenCalled();
  });

  it('restores the original fetch when uninstalled', async () => {
    const { target, hooks } = harness();
    const before = target.fetch;

    const uninstall = installFetchPatch(target, OPTIONS, hooks);
    expect(target.fetch).not.toBe(before);

    uninstall();
    expect(target.fetch).toBe(before);
  });
});
