'use client';

import { useStore } from './store';

/**
 * What just happened, in text.
 *
 * The same information the replay timeline shows, kept on screen so you can compare what the page
 * thinks happened against what the recording captured.
 */
export function ActivityLog() {
  const { log } = useStore();

  return (
    <section className="panel">
      <h2>Activity</h2>
      <ol className="log">
        {log.length === 0 ? (
          <li className="empty">Nothing yet.</li>
        ) : (
          log.map((entry) => (
            <li key={entry.id} className={entry.tone}>
              {entry.at} {entry.message}
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
