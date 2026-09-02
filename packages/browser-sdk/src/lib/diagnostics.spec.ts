import { describe, expect, it, vi } from 'vitest';
import {
  MAX_CONSOLE_MESSAGE_CHARS,
  MAX_ERROR_MESSAGE_CHARS,
} from '@syncline/protocol';
import {
  describeThrown,
  installConsoleCapture,
  installErrorCapture,
  renderConsoleArgs,
  renderValue,
} from './diagnostics.js';

const ORIGIN = 'https://app.acme.com';

/** Enough of an event target to see what was registered and to fire it. */
function fakeWindow() {
  const listeners = new Map<string, EventListener>();
  return {
    listeners,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type);
    }),
    fire(type: string, event: unknown) {
      listeners.get(type)?.(event as Event);
    },
  };
}

describe('describeThrown', () => {
  it('keeps the name, message and stack of a real Error', () => {
    const error = new TypeError('cart is undefined');
    error.stack = 'TypeError: cart is undefined\n  at checkout';

    expect(describeThrown(error)).toEqual({
      name: 'TypeError',
      message: 'cart is undefined',
      stack: 'TypeError: cart is undefined\n  at checkout',
    });
  });

  it('records what was thrown even when it was not an Error', () => {
    // `throw 'nope'` is legal and happens. "The app threw the string 'nope'" is still the answer.
    expect(describeThrown('nope')).toEqual({ message: 'nope' });
    expect(describeThrown(undefined)).toEqual({ message: 'undefined' });
  });

  it('truncates a message the page made enormous', () => {
    const described = describeThrown(new Error('x'.repeat(50_000)));
    expect(described.message.length).toBe(MAX_ERROR_MESSAGE_CHARS);
    expect(described.message.endsWith('…')).toBe(true);
  });
});

describe('renderValue', () => {
  it('renders primitives as themselves', () => {
    expect(renderValue('hi')).toBe('hi');
    expect(renderValue(42)).toBe('42');
    expect(renderValue(null)).toBe('null');
  });

  it('goes one level into an object and no further', () => {
    // Depth is the privacy control: a response body or a React fibre hangs off the second level.
    expect(renderValue({ sku: 'NW-2277', meta: { token: 'secret' } })).toBe(
      '{"sku":"NW-2277","meta":"[Object]"}',
    );
  });

  it('survives a circular reference', () => {
    const loop: Record<string, unknown> = { name: 'cart' };
    loop['self'] = loop;
    expect(renderValue(loop)).toBe('{"name":"cart","self":"[Object]"}');
  });

  it('names a DOM node rather than serializing the page into a log line', () => {
    expect(renderValue({ nodeType: 1, nodeName: 'DIV' })).toBe('<div>');
  });

  it('describes a function without invoking anything', () => {
    expect(renderValue(function checkout() {})).toBe('[Function checkout]');
  });
});

describe('renderConsoleArgs', () => {
  it('joins the arguments the way the console displays them', () => {
    expect(renderConsoleArgs(['checkout failed', 502])).toBe(
      'checkout failed 502',
    );
  });

  it('bounds the result however much was passed', () => {
    const rendered = renderConsoleArgs(['y'.repeat(5_000), 'z'.repeat(5_000)]);
    expect(rendered.length).toBe(MAX_CONSOLE_MESSAGE_CHARS);
  });
});

describe('installErrorCapture', () => {
  it('reports an uncaught error with the file it came from', () => {
    const target = fakeWindow();
    const onError = vi.fn();
    installErrorCapture(target, { onError }, ORIGIN);

    target.fire('error', {
      error: new TypeError('cart is undefined'),
      message: 'Uncaught TypeError: cart is undefined',
      filename: `${ORIGIN}/static/main.js?v=abc123`,
      lineno: 42,
      colno: 7,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({
      source: 'onerror',
      name: 'TypeError',
      message: 'cart is undefined',
      // Sanitized like every other URL: the key is kept, the value is not.
      fileUrl: `${ORIGIN}/static/main.js?v`,
      line: 42,
      column: 7,
    });
  });

  it('falls back to the browser’s message for a cross-origin script', () => {
    // A script from another origin reports "Script error." and nothing else. That is still worth
    // recording: it says an error happened at a moment the replay can show.
    const target = fakeWindow();
    const onError = vi.fn();
    installErrorCapture(target, { onError }, ORIGIN);

    target.fire('error', { message: 'Script error.' });

    expect(onError.mock.calls[0][0]).toMatchObject({
      source: 'onerror',
      message: 'Script error.',
    });
  });

  it('reports an unhandled rejection, which usually has no stack worth showing', () => {
    const target = fakeWindow();
    const onError = vi.fn();
    installErrorCapture(target, { onError }, ORIGIN);

    target.fire('unhandledrejection', { reason: new Error('402 from /pay') });

    expect(onError.mock.calls[0][0]).toMatchObject({
      source: 'unhandledrejection',
      message: '402 from /pay',
    });
  });

  it('listens in the capture phase, so the page cannot swallow the error first', () => {
    const target = fakeWindow();
    installErrorCapture(target, { onError: vi.fn() }, ORIGIN);

    expect(target.addEventListener).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
      true,
    );
  });

  it('never lets its own failure reach the page', () => {
    const target = fakeWindow();
    installErrorCapture(
      target,
      {
        onError() {
          throw new Error('the recorder is broken');
        },
      },
      ORIGIN,
    );

    // This runs inside the page's error path. Throwing here turns one bug into two.
    expect(() => target.fire('error', { message: 'boom' })).not.toThrow();
  });

  it('removes both listeners when the recording stops', () => {
    const target = fakeWindow();
    const uninstall = installErrorCapture(target, { onError: vi.fn() }, ORIGIN);

    uninstall();
    expect(target.listeners.size).toBe(0);
  });
});

describe('installConsoleCapture', () => {
  function fakeConsole() {
    return {
      error: vi.fn(),
      warn: vi.fn(),
      log: vi.fn(),
    } as unknown as Record<string, unknown>;
  }

  it('wraps only the levels asked for', () => {
    const target = fakeConsole();
    const original = target['log'];
    installConsoleCapture(target, ['error', 'warn'], { onConsole: vi.fn() });

    expect(target['error']).not.toBe(original);
    expect(target['log']).toBe(original);
  });

  it('calls the application’s console first, with its own arguments', () => {
    const target = fakeConsole();
    const spy = target['error'] as ReturnType<typeof vi.fn>;
    installConsoleCapture(target, ['error'], { onConsole: vi.fn() });

    (target['error'] as (...a: unknown[]) => void)('checkout failed', 502);

    expect(spy).toHaveBeenCalledWith('checkout failed', 502);
  });

  it('records the level and the rendered arguments', () => {
    const target = fakeConsole();
    const onConsole = vi.fn();
    installConsoleCapture(target, ['warn'], { onConsole });

    (target['warn'] as (...a: unknown[]) => void)('retrying', { attempt: 2 });

    expect(onConsole.mock.calls[0][0]).toMatchObject({
      level: 'warn',
      message: 'retrying {"attempt":2}',
    });
  });

  it('still logs when recording the call throws', () => {
    const target = fakeConsole();
    const spy = target['error'] as ReturnType<typeof vi.fn>;
    installConsoleCapture(target, ['error'], {
      onConsole() {
        throw new Error('buffer exploded');
      },
    });

    expect(() =>
      (target['error'] as (...a: unknown[]) => void)('still important'),
    ).not.toThrow();
    expect(spy).toHaveBeenCalledWith('still important');
  });

  it('puts the original back', () => {
    const target = fakeConsole();
    const original = target['error'];
    installConsoleCapture(target, ['error'], { onConsole: vi.fn() })();

    expect(target['error']).toBe(original);
  });

  it('leaves a later patch alone rather than reverting somebody else’s wrapper', () => {
    // Another vendor wrapping the same method after us is ordinary. Restoring blindly would
    // uninstall their logging, and they would never know why it stopped.
    const target = fakeConsole();
    const uninstall = installConsoleCapture(target, ['error'], {
      onConsole: vi.fn(),
    });

    const theirs = vi.fn();
    target['error'] = theirs;
    uninstall();

    expect(target['error']).toBe(theirs);
  });
});
