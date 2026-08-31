'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Product } from '@/lib/products';

/**
 * Cart and activity log, shared across the three routes.
 *
 * Client state in a provider rather than a store library: the point of the example is the recording,
 * and a cart that survives client-side navigation is all this needs to be. The activity log is here
 * too so a request made on one page is still visible after navigating to another — the same thing the
 * replay timeline shows, only in text.
 */

export interface LogEntry {
  id: number;
  at: string;
  message: string;
  tone: 'ok' | 'bad';
}

interface StoreValue {
  cart: Product[];
  log: LogEntry[];
  add(product: Product): void;
  clear(): void;
  note(message: string, tone?: 'ok' | 'bad'): void;
  call(method: string, path: string, body?: unknown): Promise<unknown>;
}

const StoreContext = createContext<StoreValue | null>(null);

let nextId = 1;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Product[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);

  const note = useCallback((message: string, tone: 'ok' | 'bad' = 'ok') => {
    setLog((entries) =>
      [
        {
          id: nextId++,
          at: new Date().toISOString().slice(11, 19),
          message,
          tone,
        },
        ...entries,
      ].slice(0, 12),
    );
  }, []);

  /**
   * One place where every request is made, so every request is traced the same way.
   *
   * Nothing here mentions Syncline. `fetch` is already patched by the time this runs, and that is
   * the point: instrumenting a call site is not something an application should have to remember.
   */
  const call = useCallback(
    async (method: string, path: string, body?: unknown) => {
      const started = performance.now();

      const response = await fetch(path, {
        method,
        ...(body
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {}),
      });

      const elapsed = Math.round(performance.now() - started);
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      note(
        `${method} ${path} → ${response.status} in ${elapsed}ms${
          payload.error ? ` · ${payload.error}` : ''
        }`,
        response.ok ? 'ok' : 'bad',
      );

      return payload;
    },
    [note],
  );

  const value = useMemo<StoreValue>(
    () => ({
      cart,
      log,
      add: (product) => setCart((items) => [...items, product]),
      clear: () => setCart([]),
      note,
      call,
    }),
    [cart, log, note, call],
  );

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside StoreProvider');
  return value;
}
