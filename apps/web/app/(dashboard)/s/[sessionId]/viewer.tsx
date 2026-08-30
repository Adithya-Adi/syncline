'use client';

/**
 * The viewer.
 *
 * One rule governs the whole component: **the player is the master clock.** The lanes never hold a
 * time of their own — they read `replayer.getCurrentTime()` on every frame. Two clocks would drift,
 * and reconciling them would be a permanent source of "the span is in the wrong place" bugs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'rrweb-player/dist/style.css';
import type {
  SessionResponse,
  TraceResponse,
  ViewerSpan,
} from '@syncline/protocol';

/**
 * Recording data comes from this app, not from the ingest API.
 *
 * The API's read endpoints were reachable by anyone holding a session id, so fetching from them
 * meant the viewer bypassed every access check the dashboard had. These routes resolve the
 * signed-in viewer and scope each query to their organization; the browser sends its session
 * cookie because every request below is same-origin.
 */

type LaneKey = 'network' | 'backend' | 'database';

interface Bar {
  key: string;
  lane: LaneKey;
  startMs: number;
  endMs: number;
  label: string;
  error: boolean;
  traceId?: string;
  span?: ViewerSpan;
  status?: number;
}

const LANES: { key: LaneKey; label: string; color: string }[] = [
  { key: 'network', label: 'Network', color: 'var(--stratum-network)' },
  { key: 'backend', label: 'Backend', color: 'var(--stratum-backend)' },
  { key: 'database', label: 'Database', color: 'var(--stratum-database)' },
];

export function Viewer({ sessionId }: { sessionId: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<{
    getReplayer: () => { getCurrentTime: () => number };
  } | null>(null);
  const buildingRef = useRef(false);

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [traces, setTraces] = useState<Record<string, TraceResponse>>({});
  const [error, setError] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [selected, setSelected] = useState<Bar | null>(null);

  // ------------------------------------------------------------------ data

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/recordings/${sessionId}`);
        // A recording in another organization and one that never existed are both 404, and the
        // message says so without distinguishing them — the difference would confirm it exists.
        if (res.status === 404) {
          throw new Error(
            'That recording does not exist, or is not in your organization.',
          );
        }
        if (!res.ok)
          throw new Error(`Could not load the recording (${res.status}).`);
        const data = (await res.json()) as SessionResponse;
        if (!cancelled) setSession(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'could not load session');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Traces are fetched per link rather than in one call: a long session has many, and the viewer
  // only needs the ones it is about to draw.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const ids = [...new Set(session.links.map((l) => l.traceId))];

    (async () => {
      for (const traceId of ids) {
        try {
          const res = await fetch(
            `/api/recordings/${sessionId}/traces/${traceId}`,
          );
          if (!res.ok) continue;
          const data = (await res.json()) as TraceResponse;
          if (cancelled) return;
          setTraces((prev) => ({ ...prev, [traceId]: data }));
        } catch {
          // A missing trace is an ordinary state — the backend may not be instrumented at all.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, sessionId]);

  // ---------------------------------------------------------------- player

  useEffect(() => {
    if (!session || !stageRef.current) return;

    // Claimed synchronously. `playerRef` is only assigned after two awaits, so checking it alone
    // lets StrictMode's double-invoke — or any fast remount — build two players into one element.
    if (buildingRef.current) return;
    buildingRef.current = true;

    let cancelled = false;
    let built: { $destroy?: () => void } | null = null;

    (async () => {
      const events: unknown[] = [];
      for (const chunk of session.chunks) {
        const res = await fetch(chunk.url);
        if (!res.ok) continue;
        const body = (await res.json()) as { events: unknown[] };
        events.push(...body.events);
      }

      if (cancelled || !stageRef.current) return;

      // rrweb needs a full snapshot plus something after it before there is anything to play.
      if (events.length < 2) {
        setError('recording has too few events to replay');
        return;
      }

      // rrweb-player is a Svelte component and reaches for `document` at import time, so it is
      // loaded here rather than at module scope.
      const { default: RrwebPlayer } = await import('rrweb-player');
      if (cancelled || !stageRef.current) return;

      const recorded = session.meta.viewport ?? { w: 1024, h: 768 };

      // Scale the recording into the space that is actually left, rather than letting its original
      // viewport dictate the layout. Sizing from `recorded` alone pushes the strata off the bottom
      // of the screen on any recording taller than the gap — which is the common case, and it
      // hides the one thing this page exists to show.
      //
      // The controller is rrweb's own transport bar, drawn below the canvas and not counted in the
      // height prop, so it has to come out of the budget explicitly.
      const CONTROLLER_HEIGHT = 90;
      const budgetWidth = Math.max(320, stageRef.current.clientWidth - 8);
      const budgetHeight = Math.max(
        200,
        stageRef.current.clientHeight - 8 - CONTROLLER_HEIGHT,
      );

      const scale = Math.min(
        budgetWidth / recorded.w,
        budgetHeight / recorded.h,
        1,
      );
      const width = Math.floor(recorded.w * scale);
      const height = Math.floor(recorded.h * scale);

      built = new RrwebPlayer({
        target: stageRef.current,
        props: {
          events: events as never,
          width,
          height,
          autoPlay: false,
          // rrweb's controller stays: it is the transport, and the strata below are a read-only
          // view of the same clock. Building a second set of play controls would be the thing
          // that introduces two clocks, not this.
          showController: true,
          mouseTail: false,
        },
      }) as never;

      playerRef.current = built as never;
    })();

    return () => {
      cancelled = true;
      // Svelte components are not garbage collected just because the element goes away — they
      // keep timers and listeners running. Without this, navigating between recordings leaves a
      // player playing into a detached DOM.
      built?.$destroy?.();
      playerRef.current = null;
      buildingRef.current = false;
    };
  }, [session]);

  // The lanes follow the player, every frame, forever. This is the master-clock rule in code.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const replayer = playerRef.current?.getReplayer?.();
      // Before playback starts, rrweb reports baselineTime minus the first event's timestamp,
      // which is a large negative number rather than zero. Taken at face value it puts the core
      // sample tens of thousands of pixels off the left edge.
      if (replayer) setCurrentMs(Math.max(0, replayer.getCurrentTime()));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ------------------------------------------------------------------ bars

  const { bars, startMs, durationMs } = useMemo(() => {
    if (!session) return { bars: [] as Bar[], startMs: 0, durationMs: 1 };

    const start = session.startedMs;
    const end = session.endedMs ?? start + (session.durationMs ?? 1000);
    const out: Bar[] = [];

    for (const link of session.links) {
      out.push({
        key: `link:${link.spanId}`,
        lane: 'network',
        startMs: link.startMs,
        endMs: link.endMs,
        label: `${link.method} ${shortPath(link.url)}`,
        error: (link.status ?? 200) >= 400,
        traceId: link.traceId,
        ...(link.status !== undefined ? { status: link.status } : {}),
      });
    }

    for (const trace of Object.values(traces)) {
      for (const span of trace.spans) {
        out.push({
          key: `span:${span.spanId}`,
          lane:
            typeof span.attributes['db.system'] === 'string'
              ? 'database'
              : 'backend',
          startMs: span.startClientMs,
          endMs: span.endClientMs,
          label: span.name,
          error: span.status === 'ERROR',
          span,
        });
      }
    }

    // The recording's own window can be narrower than the spans it references — a request that
    // outlived the last chunk, for instance. Widen rather than clip, so nothing is drawn offscreen.
    const min = out.reduce((m, b) => Math.min(m, b.startMs), start);
    const max = out.reduce((m, b) => Math.max(m, b.endMs), end);

    return { bars: out, startMs: min, durationMs: Math.max(1, max - min) };
  }, [session, traces]);

  /**
   * The window the strata are drawn against.
   *
   * Without this the timeline is useless on any real recording: a 17ms request inside a five
   * second session is a third of a percent of the width. `null` means the whole recording; picking
   * a bar narrows to that request, which is the only time the backend and database lanes are
   * legible.
   */
  const [focus, setFocus] = useState<{ from: number; to: number } | null>(null);

  const view = useMemo(() => {
    if (!focus) return { from: startMs, span: durationMs };
    // A quarter of the window as padding on each side, so the request has visible context rather
    // than sitting flush against both edges.
    const width = Math.max(1, focus.to - focus.from);
    const pad = width * 0.25;
    const from = Math.max(startMs, focus.from - pad);
    const to = Math.min(startMs + durationMs, focus.to + pad);
    return { from, span: Math.max(1, to - from) };
  }, [focus, startMs, durationMs]);

  const pct = useCallback(
    (ms: number) => ((ms - view.from) / view.span) * 100,
    [view],
  );

  // The player keeps counting past the last recorded event, so the playhead can exceed the
  // timeline it is drawn on. Bars are real measurements and stay where they fall; the core sample
  // is a cursor, and a cursor outside the chart is just gone.
  const clampedPct = useCallback(
    (ms: number) => Math.min(100, Math.max(0, pct(ms))),
    [pct],
  );

  const playheadMs = session ? session.startedMs + currentMs : startMs;

  // Once the timeline is zoomed, the playhead is usually outside the window. Clamping it to an
  // edge would draw a cursor claiming the player is somewhere it is not, so it is simply not drawn
  // — the same answer a scrolled-away cursor gets in any editor.
  const playheadInView =
    playheadMs >= view.from && playheadMs <= view.from + view.span;
  // From this session's own calibration rather than whichever trace happened to arrive first:
  // the band describes how well this recording's clock is known, and every trace it references
  // inherits that same uncertainty.
  const uncertaintyMs =
    session && session.clock.rttMs >= 100
      ? Math.round(session.clock.rttMs / 2)
      : 0;

  // ----------------------------------------------------------------- render

  if (error) {
    return (
      <div className="notice">
        {error}
        <br />
        <code>{sessionId}</code>
      </div>
    );
  }

  if (!session) return <div className="notice">Loading session…</div>;

  return (
    <div className="viewer">
      <div className="railbar">
        <a className="wordmark" href="/sessions">
          syncline
        </a>
        <Field label="session" value={session.id} />
        {session.meta.url && (
          <Field label="page" value={shortPath(session.meta.url)} />
        )}
        {session.meta.release && (
          <Field label="release" value={session.meta.release} />
        )}
        {session.meta.user && (
          <Field label="user" value={session.meta.user.id} />
        )}
        <Field label="duration" value={`${session.durationMs ?? 0}ms`} />
        <Field
          label="skew"
          value={`${session.clock.offsetMs}ms ±${Math.round(session.clock.rttMs / 2)}`}
        />
      </div>

      <div className="stage" ref={stageRef} />

      <div className="strata">
        {focus && (
          <div className="strata__focus">
            <span className="eyebrow">
              showing {Math.round(view.span)}ms of {Math.round(durationMs)}ms
            </span>
            <button
              type="button"
              className="strata__fit"
              onClick={() => setFocus(null)}
            >
              Fit whole recording
            </button>
          </div>
        )}

        <Ruler fromMs={view.from - startMs} spanMs={view.span} />

        <div className="strata__lanes">
          {LANES.map((lane) => (
            <div className="lane" key={lane.key}>
              <div className="lane__label">
                <span
                  className="lane__swatch"
                  style={{ background: lane.color }}
                />
                {lane.label}
              </div>
              <div className="lane__track">
                {bars
                  .filter((b) => b.lane === lane.key)
                  .map((bar) => {
                    const left = pct(bar.startMs);
                    const width = Math.max(0.25, pct(bar.endMs) - left);
                    const live =
                      playheadMs >= bar.startMs && playheadMs <= bar.endMs;
                    return (
                      <button
                        key={bar.key}
                        type="button"
                        onClick={() => {
                          setSelected(bar);
                          // Selecting is also how you zoom. On a real recording a request is a
                          // fraction of a percent of the width, so inspecting one and narrowing to
                          // it are the same intent — asking for a separate gesture would just mean
                          // performing two.
                          setFocus({ from: bar.startMs, to: bar.endMs });
                        }}
                        className={`bar${live ? ' bar--live' : ''}${bar.error ? ' bar--error' : ''}`}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: lane.color,
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                        }}
                        title={`${bar.label} · ${Math.round(bar.endMs - bar.startMs)}ms`}
                      >
                        {width > 12 && (
                          <span className="bar__caption">{bar.label}</span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}

          {/*
            The clock was measured over a round trip, so a server timestamp is only known to within
            half of it. Drawing a band is more honest than drawing a line that implies otherwise.
          */}
          {uncertaintyMs > 0 && playheadInView && (
            <div
              className="uncertainty"
              style={{
                left: `calc(108px + (100% - 108px) * ${clampedPct(playheadMs - uncertaintyMs) / 100})`,
                // Scaled to the visible window, not the whole recording: zoomed in, the same
                // number of milliseconds of uncertainty covers proportionally more of the screen.
                width: `calc((100% - 108px) * ${(uncertaintyMs * 2) / view.span})`,
              }}
            />
          )}

          {playheadInView && (
            <div
              className="core"
              style={{
                left: `calc(108px + (100% - 108px) * ${clampedPct(playheadMs) / 100})`,
              }}
            >
              <span className="core__readout">{Math.round(currentMs)}ms</span>
            </div>
          )}
        </div>
      </div>

      <Detail bar={selected} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="railbar__field">
      <span className="railbar__key">{label}</span>
      <span className="railbar__value">{value}</span>
    </span>
  );
}

/**
 * Labels are offsets from the start of the recording, not from the start of the window. When you
 * zoom into a request 4 seconds in, the ruler should say 4,012ms — a window that restarted at zero
 * would lose the only number that ties the strata back to the video.
 */
function Ruler({ fromMs, spanMs }: { fromMs: number; spanMs: number }) {
  const steps = 6;
  return (
    <div className="strata__ruler">
      {Array.from({ length: steps + 1 }, (_, i) => {
        const at = (i / steps) * 100;
        return (
          <span
            key={i}
            className={`strata__tick${i === steps ? ' strata__tick--last' : ''}`}
            style={{ left: `calc(108px + (100% - 108px) * ${at / 100})` }}
          >
            {Math.round(fromMs + (spanMs * i) / steps)}ms
          </span>
        );
      })}
    </div>
  );
}

function Detail({ bar }: { bar: Bar | null }) {
  if (!bar) {
    return (
      <div className="detail">
        <span className="eyebrow">Selection</span>
        <p style={{ color: 'var(--bone-500)', margin: '8px 0 0' }}>
          Pick a bar to see what it was.
        </p>
      </div>
    );
  }

  const attributes = bar.span ? Object.entries(bar.span.attributes) : [];

  return (
    <div className="detail">
      <div className="detail__head">
        <span className="detail__name">{bar.label}</span>
        <span className="eyebrow">{Math.round(bar.endMs - bar.startMs)}ms</span>
        {bar.span && <span className="eyebrow">{bar.span.serviceName}</span>}
        {bar.span && <span className="eyebrow">{bar.span.kind}</span>}
        {bar.status !== undefined && (
          <span className="eyebrow">HTTP {bar.status}</span>
        )}
        {bar.error && <span style={{ color: 'var(--fault)' }}>error</span>}
      </div>

      <dl className="detail__attrs">
        {bar.traceId && (
          <div className="detail__attr">
            <dt>trace</dt>
            <dd>{bar.traceId}</dd>
          </div>
        )}
        {attributes.map(([key, value]) => (
          <div className="detail__attr" key={key}>
            <dt>{key}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function shortPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}
