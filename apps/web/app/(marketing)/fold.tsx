'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * The hero diagram, and the only mockup on the page.
 *
 * A pre-alpha product cannot honestly show a product screenshot, so the argument is drawn instead:
 * three strata with one axis through them, which is the product's whole idea at small scale. The
 * playhead is a core sample — one instant, cut through every layer at once — and a bar only lights
 * once the sample has reached it, so the animation is making the claim rather than decorating it.
 *
 * Two things it deliberately does: it stops when scrolled out of view (an off-screen loop is spent
 * battery), and under reduced motion it renders the finished frame with everything already lit.
 */

const DURATION_MS = 1749;
const SWEEP_MS = 3600;
const HOLD_MS = 900;

const STRATA = [
  {
    label: 'Network',
    color: 'var(--stratum-network)',
    bars: [
      [4, 7],
      [20, 5],
      [38, 26],
      [80, 9],
    ],
  },
  {
    label: 'Backend',
    color: 'var(--stratum-backend)',
    bars: [
      [40, 22],
      [81, 7],
    ],
  },
  {
    label: 'Database',
    color: 'var(--stratum-database)',
    bars: [[44, 16]],
  },
] as const;

export function Fold({ compact = false }: { compact?: boolean }) {
  const still = useReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);

  // Pause the loop when the diagram is off screen. The observer is the only thing still running
  // while it is, so scrolling past costs nothing.
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (still || !visible) return;

    let raf = 0;
    let start = performance.now();
    setProgress(0);

    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed > SWEEP_MS + HOLD_MS) {
        start = now;
        setProgress(0);
      } else {
        setProgress(Math.min(100, (elapsed / SWEEP_MS) * 100));
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [still, visible]);

  const elapsedMs = Math.round((progress / 100) * DURATION_MS);
  const sweeping = progress > 0 && progress < 100;

  return (
    <div
      ref={frame}
      aria-hidden="true"
      className="overflow-hidden rounded-xl border bg-card/60"
    >
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2.5 sm:px-6">
        {/* The panel this sits in when compact is too narrow for both halves to stay on one line. */}
        {!compact && (
          <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            One request, three layers
          </span>
        )}
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          POST /api/checkout ·{' '}
          <span className="text-foreground">{elapsedMs.toLocaleString()}ms</span>
        </span>
      </div>

      <div className={`relative ${compact ? 'px-4 py-4' : 'px-4 py-6 sm:px-6'}`}>
        <div className="flex flex-col gap-2.5">
          {STRATA.map((stratum) => (
            <div
              key={stratum.label}
              className="grid grid-cols-[4rem_1fr] items-center gap-3 sm:grid-cols-[5rem_1fr]"
            >
              <div className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                {stratum.label}
              </div>
              <div
                className={`relative rounded-sm bg-muted/60 ${compact ? 'h-4' : 'h-5'}`}
              >
                {stratum.bars.map(([left, width]) => {
                  const lit = progress >= left;
                  return (
                    <span
                      key={left}
                      className="ease-brand absolute top-1/2 h-2 -translate-y-1/2 rounded-[2px] transition-[opacity,filter] duration-500"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: stratum.color,
                        opacity: lit ? 1 : 0.25,
                        filter: lit ? 'none' : 'saturate(0.3)',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/*
         * The core sample lives in a box that starts and ends exactly where the tracks do, so its
         * percentage is the same percentage the bars use. Nothing to keep in sync by hand if the
         * label column ever changes width — only these two offsets.
         *
         * left = padding + label column + gap.
         */}
        <div className="pointer-events-none absolute inset-y-0 right-4 left-[5.75rem] sm:right-6 sm:left-[7.25rem]">
          <div
            className="absolute inset-y-3 w-px transition-opacity duration-300"
            style={{
              left: `${progress}%`,
              background:
                'linear-gradient(to bottom, transparent, var(--stratum-network) 18%, var(--stratum-network) 82%, transparent)',
              opacity: sweeping ? 1 : 0,
            }}
          >
            <span
              className="absolute -top-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full"
              style={{ background: 'var(--stratum-network)' }}
            />
          </div>
        </div>
      </div>

      {!compact && (
        <p className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-6">
          The vertical column is a core sample — one instant, cut through every
          layer at once.
        </p>
      )}
    </div>
  );
}
