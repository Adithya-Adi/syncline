'use client';

import { useEffect, useState } from 'react';

const USER_KEY = 'syncline-example-user';

/**
 * Changing the user id.
 *
 * A reload rather than a live swap: the SDK sets identity when the session starts, so a new identity
 * honestly means a new session. This exists so that "find the recording for customer X" has a
 * specific customer to look for.
 */
export function Identity() {
  const [userId, setUserId] = useState('');

  useEffect(() => {
    try {
      setUserId(localStorage.getItem(USER_KEY) ?? '');
    } catch {
      /* storage refused; the field simply starts empty */
    }
  }, []);

  return (
    <section className="panel">
      <h2>Who is this session?</h2>
      <p className="hint">
        Sent as the session&rsquo;s user id, which is how you find this
        recording again later. Changing it starts a new recording.
      </p>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          const next = userId.trim();
          if (!next) return;
          try {
            localStorage.setItem(USER_KEY, next);
          } catch {
            /* not fatal */
          }
          window.location.reload();
        }}
      >
        <input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          aria-label="User id"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit">Record as this user</button>
      </form>
    </section>
  );
}
