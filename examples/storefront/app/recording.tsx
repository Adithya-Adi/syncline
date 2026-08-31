'use client';

import { useEffect, useState } from 'react';
import { startRecording } from 'syncline-browser';

/**
 * The entire Syncline integration.
 *
 * This is the snippet the dashboard's setup page hands out for Next.js, pasted in unchanged — the
 * example dogfoods that snippet rather than describing it. The two things worth noticing: it runs
 * once at the top of the tree, not inside a component that remounts, and the cleanup stops the
 * recorder and removes the fetch patch, which matters in development where every edit remounts.
 */

const USER_KEY = 'syncline-example-user';

/**
 * The user id is remembered so a reload keeps the same identity, and editable so that searching for
 * one customer's session has something to find.
 */
function currentUserId(): string {
  try {
    const stored = localStorage.getItem(USER_KEY);
    if (stored) return stored;
  } catch {
    // Storage is refused in some privacy modes. A fresh id per load is a fine fallback.
  }

  const generated = `u_${Math.random().toString(36).slice(2, 8)}`;
  try {
    localStorage.setItem(USER_KEY, generated);
  } catch {
    /* not fatal */
  }
  return generated;
}

export function Recording({
  publicKey,
  endpoint,
  release,
}: {
  publicKey: string;
  endpoint: string;
  release: string;
}) {
  const [identity, setIdentity] = useState<{
    userId: string;
    sessionId: string;
  } | null>(null);

  useEffect(() => {
    if (!publicKey) return;

    const userId = currentUserId();

    const recording = startRecording({
      key: publicKey,
      endpoint,
      // Only this origin. The SDK never adds a traceparent to anybody else's domain, which keeps an
      // internal trace id out of a third party's logs.
      traceOrigins: [window.location.origin],
      release,
      user: { id: userId },
      debug: true,
    });

    setIdentity({ userId, sessionId: recording.sessionId });

    return () => void recording.stop();
  }, [publicKey, endpoint, release]);

  if (!publicKey) {
    return (
      <span className="session missing">
        NEXT_PUBLIC_SYNCLINE_PUBLIC_KEY is not set
      </span>
    );
  }

  return (
    <span className="session">
      {identity ? `${identity.userId} · ${identity.sessionId}` : 'recording…'}
    </span>
  );
}
