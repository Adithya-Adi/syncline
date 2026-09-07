'use client';

/**
 * The sidecar: console output and network activity, beside the replay.
 *
 * It obeys the same rule as the strata — **the player is the master clock.** Nothing here holds a
 * time of its own; every row is placed against the `playheadMs` it is handed, and "where are we"
 * is answered by which row is the last one at or before it. That is what makes the panel readable
 * while the recording plays instead of being a log you have to correlate by eye.
 *
 * Both lists are derived from data the recording already carries. Console lines are custom events
 * in the replay stream, lifted out by the viewer; requests are the session's links, which is the
 * same data the network lane draws. Nothing new is captured for this panel, and no second request
 * is made for it.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleLevel } from '@syncline/protocol';
import { formatMs } from './format';

export type SidecarTab = 'console' | 'network';

/**
 * One line in the console list.
 *
 * Uncaught errors share the shape rather than getting a list of their own: the browser's own
 * console prints them inline with everything else, and splitting them out would mean reading two
 * lists to answer "what happened just before this". `uncaught` is set for those, so the row can
 * say which it was and hand the error to the detail panel.
 */
export interface ConsoleRow {
  key: string;
  level: ConsoleLevel;
  message: string;
  /** Client time, the same frame of reference as the replay. */
  atMs: number;
  /** Set when the row is an uncaught error rather than a console call. */
  uncaught?: boolean;
}

export interface NetworkRow {
  key: string;
  method: string;
  path: string;
  status?: number;
  /** Client time, as above. */
  startMs: number;
  durationMs: number;
  failed: boolean;
}

/** Levels in severity order, which is also the order the filter chips read in. */
const LEVELS: ConsoleLevel[] = ['error', 'warn', 'info', 'log', 'debug'];

const LEVEL_LABEL: Record<ConsoleLevel, string> = {
  error: 'ERR',
  warn: 'WRN',
  info: 'INF',
  log: 'LOG',
  debug: 'DBG',
};

/**
 * How many rows are put in the DOM at once.
 *
 * A session may legitimately carry tens of thousands of console lines — 500 per chunk, a hundred
 * chunks — and mounting all of them is slow before anything has even played. The cap is
 * chronological and stated on screen rather than silent, and the filters above it are the way past
 * it: "the first thousand, and here is how many there are" beats a panel that stalls the page.
 */
const ROW_CAP = 1_000;

export const Sidecar = memo(function Sidecar({
  tab,
  onTab,
  consoleRows,
  networkRows,
  startMs,
  playheadMs,
  onSeek,
  onPickConsole,
  onPickNetwork,
  onClose,
}: {
  tab: SidecarTab;
  onTab: (tab: SidecarTab) => void;
  consoleRows: ConsoleRow[];
  networkRows: NetworkRow[];
  /** Start of the recording, so a row can be labelled as an offset into it. */
  startMs: number;
  playheadMs: number;
  onSeek: (atMs: number) => void;
  onPickConsole: (row: ConsoleRow) => void;
  onPickNetwork: (key: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [levels, setLevels] = useState<ConsoleLevel[] | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);
  /**
   * Whether the list scrolls itself to the playhead.
   *
   * On by default, because the panel's whole value while a recording plays is that the line being
   * described is the line on screen. A toggle rather than a heuristic on scroll position: reading
   * back through a long log is a deliberate act, and having the list yank itself away a frame
   * later is the exact frustration this avoids.
   */
  const [follow, setFollow] = useState(true);

  const needle = query.trim().toLowerCase();

  const matchedConsole = useMemo(
    () =>
      consoleRows.filter(
        (row) =>
          (levels === null || levels.includes(row.level)) &&
          (needle === '' || row.message.toLowerCase().includes(needle)),
      ),
    [consoleRows, levels, needle],
  );

  const matchedNetwork = useMemo(
    () =>
      networkRows.filter(
        (row) =>
          (!failedOnly || row.failed) &&
          (needle === '' ||
            `${row.method} ${row.path}`.toLowerCase().includes(needle)),
      ),
    [networkRows, failedOnly, needle],
  );

  const shownConsole = useMemo(
    () => matchedConsole.slice(0, ROW_CAP),
    [matchedConsole],
  );

  const shownNetwork = useMemo(
    () => matchedNetwork.slice(0, ROW_CAP),
    [matchedNetwork],
  );

  const hidden =
    (tab === 'console' ? matchedConsole.length : matchedNetwork.length) -
    (tab === 'console' ? shownConsole.length : shownNetwork.length);

  const times = useMemo(
    () =>
      tab === 'console'
        ? shownConsole.map((row) => row.atMs)
        : shownNetwork.map((row) => row.startMs),
    [tab, shownConsole, shownNetwork],
  );

  // The last row at or before the playhead. Rows are sorted, so this is a scan that stops early
  // rather than a search over the whole list on every frame.
  const activeIndex = useMemo(() => {
    let index = -1;
    for (const at of times) {
      if (at > playheadMs) break;
      index += 1;
    }
    return index;
  }, [times, playheadMs]);

  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!follow) return;
    const list = listRef.current;
    const row = activeRef.current;
    if (!list || !row) return;
    // `scrollTop` rather than `scrollIntoView`: the latter scrolls every ancestor that can move,
    // which on this page means the replay sliding out from under the panel.
    const target = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
    list.scrollTop = Math.max(0, target);
  }, [follow, activeIndex, tab]);

  return (
    <aside className="sidecar">
      <div className="sidecar__tabs">
        <button
          type="button"
          className={`sidecar__tab${tab === 'console' ? ' sidecar__tab--on' : ''}`}
          onClick={() => onTab('console')}
        >
          Console
          {consoleRows.length > 0 && (
            <span className="sidecar__count">{consoleRows.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`sidecar__tab${tab === 'network' ? ' sidecar__tab--on' : ''}`}
          onClick={() => onTab('network')}
        >
          Network
          {networkRows.length > 0 && (
            <span className="sidecar__count">{networkRows.length}</span>
          )}
        </button>
        <button
          type="button"
          className="sidecar__close"
          onClick={onClose}
          title="Hide the panel"
          aria-label="Hide the panel"
        >
          ×
        </button>
      </div>

      <div className="sidecar__filters">
        <input
          className="sidecar__query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tab === 'console' ? 'Filter output' : 'Filter requests'}
          spellCheck={false}
        />

        {tab === 'console' ? (
          <div className="sidecar__chips">
            <button
              type="button"
              className={`sidecar__chip${levels === null ? ' sidecar__chip--on' : ''}`}
              onClick={() => setLevels(null)}
            >
              all
            </button>
            {LEVELS.map((level) => {
              const on = levels !== null && levels.includes(level);
              return (
                <button
                  key={level}
                  type="button"
                  className={`sidecar__chip${on ? ' sidecar__chip--on' : ''}`}
                  onClick={() =>
                    setLevels((current) => {
                      const next = new Set(current ?? []);
                      if (next.has(level)) next.delete(level);
                      else next.add(level);
                      // An empty selection means "everything" rather than "nothing": a filter
                      // that can hide the whole list looks identical to a recording with no
                      // output, and that is the one thing this panel must not be ambiguous about.
                      return next.size === 0 ? null : [...next];
                    })
                  }
                >
                  {level}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="sidecar__chips">
            <button
              type="button"
              className={`sidecar__chip${failedOnly ? '' : ' sidecar__chip--on'}`}
              onClick={() => setFailedOnly(false)}
            >
              all
            </button>
            <button
              type="button"
              className={`sidecar__chip${failedOnly ? ' sidecar__chip--on' : ''}`}
              onClick={() => setFailedOnly(true)}
            >
              failed
            </button>
          </div>
        )}

        <button
          type="button"
          className={`sidecar__chip sidecar__follow${follow ? ' sidecar__chip--on' : ''}`}
          onClick={() => setFollow((on) => !on)}
          title="Keep the list scrolled to the playhead"
        >
          follow
        </button>
      </div>

      <div className="sidecar__list" ref={listRef}>
        {tab === 'console' &&
          (shownConsole.length === 0 ? (
            <p className="sidecar__empty">
              {consoleRows.length === 0 ? (
                <>
                  Nothing was recorded. Console capture is off by default — turn
                  it on with <code>captureConsole: true</code> in{' '}
                  <code>startRecording</code>, or pass the levels you want.
                </>
              ) : (
                'No line matches the filter.'
              )}
            </p>
          ) : (
            shownConsole.map((row, index) => (
              <button
                key={row.key}
                type="button"
                ref={index === activeIndex ? activeRef : undefined}
                className={[
                  'sidecar__row',
                  index === activeIndex ? 'sidecar__row--here' : '',
                  index > activeIndex ? 'sidecar__row--ahead' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  onSeek(row.atMs);
                  onPickConsole(row);
                }}
                title={`Seek to ${formatMs(Math.max(0, row.atMs - startMs))}`}
              >
                <span className="sidecar__at">
                  {formatMs(Math.max(0, row.atMs - startMs))}
                </span>
                <span className={`sidecar__level sidecar__level--${row.level}`}>
                  {row.uncaught ? 'UNC' : LEVEL_LABEL[row.level]}
                </span>
                <span className="sidecar__message">{row.message}</span>
              </button>
            ))
          ))}

        {tab === 'network' &&
          (shownNetwork.length === 0 ? (
            <p className="sidecar__empty">
              {networkRows.length === 0
                ? 'The page made no requests the SDK saw.'
                : 'No request matches the filter.'}
            </p>
          ) : (
            shownNetwork.map((row, index) => (
              <button
                key={row.key}
                type="button"
                ref={index === activeIndex ? activeRef : undefined}
                className={[
                  'sidecar__row',
                  'sidecar__row--net',
                  index === activeIndex ? 'sidecar__row--here' : '',
                  index > activeIndex ? 'sidecar__row--ahead' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  onSeek(row.startMs);
                  onPickNetwork(row.key);
                }}
                title={`${row.method} ${row.path} · ${Math.round(row.durationMs)}ms`}
              >
                <span className="sidecar__at">
                  {formatMs(Math.max(0, row.startMs - startMs))}
                </span>
                <span className="sidecar__method">{row.method}</span>
                <span className="sidecar__message">{row.path}</span>
                <span
                  className={`sidecar__status${row.failed ? ' sidecar__status--error' : ''}`}
                >
                  {/* A request with no status never got a response — a dash, not a zero, which
                      would read as a code something actually returned. */}
                  {row.status ?? '—'}
                </span>
                <span className="sidecar__dur">
                  {Math.round(row.durationMs)}ms
                </span>
              </button>
            ))
          ))}

        {hidden > 0 && (
          <p className="sidecar__more">
            {hidden.toLocaleString()} more not shown. Narrow the list with the
            filter above.
          </p>
        )}
      </div>
    </aside>
  );
});
