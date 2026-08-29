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
import type { SessionResponse, TraceResponse, ViewerSpan } from '@syncline/protocol';

const API = process.env.NEXT_PUBLIC_SYNCLINE_API ?? 'http://localhost:4000';

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
  const playerRef = useRef<{ getReplayer: () => { getCurrentTime: () => number } } | null>(null);

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
        const res = await fetch(`${API}/v1/sessions/${sessionId}`);
        if (!res.ok) throw new Error(`session ${res.status}`);
        const data = (await res.json()) as SessionResponse;
        if (!cancelled) setSession(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'could not load session');
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
          const res = await fetch(`${API}/v1/traces/${traceId}`);
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
  }, [session]);

  // ---------------------------------------------------------------- player

  useEffect(() => {
    if (!session || !stageRef.current || playerRef.current) return;
    let cancelled = false;

    (async () => {
      const events: unknown[] = [];
      for (const chunk of session.chunks) {
        const res = await fetch(`${API}${chunk.url}`);
        if (!res.ok) continue;
        const body = (await res.json()) as { events: unknown[] };
        events.push(...body.events);
      }

      if (cancelled || !stageRef.current || events.length < 2) {
        if (!cancelled && events.length < 2) setError('recording has too few events to replay');
        return;
      }

      // rrweb-player is a Svelte component and reaches for `document` at import time, so it is
      // loaded here rather than at module scope.
      const { default: RrwebPlayer } = await import('rrweb-player');

      const width = Math.min(stageRef.current.clientWidth - 4, session.meta.viewport?.w ?? 1024);
      const height = Math.round(width * ((session.meta.viewport?.h ?? 768) / (session.meta.viewport?.w ?? 1024)));

      playerRef.current = new RrwebPlayer({
        target: stageRef.current,
        props: {
          events: events as never,
          width,
          height,
          autoPlay: false,
          // Syncline draws its own timeline; a second scrubber would be two clocks in one screen.
          showController: true,
          mouseTail: false,
        },
      }) as never;
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  // The lanes follow the player, every frame, forever. This is the master-clock rule in code.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const replayer = playerRef.current?.getReplayer?.();
      if (replayer) setCurrentMs(replayer.getCurrentTime());
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
          lane: typeof span.attributes['db.system'] === 'string' ? 'database' : 'backend',
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

  const pct = useCallback(
    (ms: number) => ((ms - startMs) / durationMs) * 100,
    [startMs, durationMs]
  );

  const playheadMs = session ? session.startedMs + currentMs : startMs;
  const uncertaintyMs = Object.values(traces)[0]?.uncertaintyMs ?? 0;

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
        <span className="wordmark">syncline</span>
        <Field label="session" value={session.id} />
        {session.meta.url && <Field label="page" value={shortPath(session.meta.url)} />}
        {session.meta.release && <Field label="release" value={session.meta.release} />}
        {session.meta.user && <Field label="user" value={session.meta.user.id} />}
        <Field label="duration" value={`${session.durationMs ?? 0}ms`} />
        <Field label="skew" value={`${session.clock.offsetMs}ms ±${Math.round(session.clock.rttMs / 2)}`} />
      </div>

      <div className="stage" ref={stageRef} />

      <div className="strata">
        <Ruler durationMs={durationMs} />

        <div className="strata__lanes">
          {LANES.map((lane) => (
            <div className="lane" key={lane.key}>
              <div className="lane__label">
                <span className="lane__swatch" style={{ background: lane.color }} />
                {lane.label}
              </div>
              <div className="lane__track">
                {bars
                  .filter((b) => b.lane === lane.key)
                  .map((bar) => {
                    const left = pct(bar.startMs);
                    const width = Math.max(0.25, pct(bar.endMs) - left);
                    const live = playheadMs >= bar.startMs && playheadMs <= bar.endMs;
                    return (
                      <button
                        key={bar.key}
                        type="button"
                        onClick={() => setSelected(bar)}
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
                        {width > 12 && <span className="bar__caption">{bar.label}</span>}
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
          {uncertaintyMs > 0 && (
            <div
              className="uncertainty"
              style={{
                left: `calc(108px + (100% - 108px) * ${pct(playheadMs - uncertaintyMs) / 100})`,
                width: `calc((100% - 108px) * ${(uncertaintyMs * 2) / durationMs})`,
              }}
            />
          )}

          <div className="core" style={{ left: `calc(108px + (100% - 108px) * ${pct(playheadMs) / 100})` }}>
            <span className="core__readout">{Math.round(currentMs)}ms</span>
          </div>
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

function Ruler({ durationMs }: { durationMs: number }) {
  const steps = 6;
  return (
    <div className="strata__ruler">
      {Array.from({ length: steps + 1 }, (_, i) => {
        const at = (i / steps) * 100;
        return (
          <span
            key={i}
            className="strata__tick"
            style={{ left: `calc(108px + (100% - 108px) * ${at / 100})` }}
          >
            {Math.round((durationMs * i) / steps)}ms
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
        {bar.status !== undefined && <span className="eyebrow">HTTP {bar.status}</span>}
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
