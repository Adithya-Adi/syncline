import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { REPO, SiteShell } from './(marketing)/shell';
import { Fold } from './(marketing)/fold';
import { Reveal } from './(marketing)/reveal';
import { SectionRail } from './(marketing)/section-rail';
import { C, CodeBlock, K, S } from './(marketing)/code-block';

/**
 * The landing page.
 *
 * The hero is the product's own idea drawn at small scale — three strata with one axis through
 * them — rather than a screenshot the project cannot yet honestly show, or a gradient that says
 * nothing. Everything below answers one of the four questions someone actually has: what is this,
 * how does it work, what does it cost me to try, and is it real yet.
 *
 * Sections carry a numeral because the page is an argument in order, not a feature list, and
 * numbering makes that legible. Decoration is confined to the hero and the closing band: one grid,
 * one glow, and hairlines everywhere else.
 */

const SECTIONS = [
  { id: 'top', label: 'Start' },
  { id: 'seam', label: 'The seam' },
  { id: 'stitch', label: 'The stitch' },
  { id: 'integration', label: 'Integration' },
  { id: 'properties', label: 'Properties' },
  { id: 'viewer', label: 'The viewer' },
];

const SEAM = [
  {
    label: 'Session replay',
    body: 'Shows you the browser. The click, the hesitation, the field they gave up on — and then it stops at the network boundary.',
  },
  {
    label: 'Distributed tracing',
    body: 'Shows you the backend. Spans, services, the query that took 1.8 seconds — with no idea which person was sitting there waiting on it.',
  },
  {
    label: 'The seam',
    body: 'Neither shows you this. So “checkout felt slow” is still archaeology: eyeball a video, guess a timestamp, go hunting in another tool with a different clock.',
    accent: true,
  },
];

const STEPS = [
  {
    n: '01',
    title: 'The browser mints the trace id.',
    body: 'The SDK patches fetch and XHR and attaches a W3C traceparent to requests bound for origins you list — never to anyone else’s.',
  },
  {
    n: '02',
    title: 'It writes that id into the recording.',
    body: 'An rrweb custom event lands at the exact frame the request fired, so the replay carries its own index.',
  },
  {
    n: '03',
    title: 'Your backend does nothing special.',
    body: 'Standard OpenTelemetry reads the header and continues the trace. Database spans inherit it.',
  },
  {
    n: '04',
    title: 'The viewer resolves the seam.',
    body: 'Player time, to trace id, to span tree — drawn beneath the video on the same clock.',
  },
];

const PROPERTIES = [
  {
    key: 'a',
    title: 'The link is an id, not a timestamp',
    body: 'The browser mints a W3C traceparent and writes it into the replay stream at the frame the request fired. Clock skew can misdraw a lane by milliseconds; it can never attribute a request to the wrong trace.',
  },
  {
    key: 'b',
    title: 'Sampling runs backwards',
    body: 'The browser decides. A recorded session forces sampled=1, so you never open the replay of a slow request whose spans were thrown away — which is exactly the request you wanted.',
  },
  {
    key: 'c',
    title: 'No backend SDK, ever',
    body: 'Syncline is a plain OTLP sink. Point any OpenTelemetry exporter at it and the trace continues. It can sit beside your existing tracing vendor through a collector fan-out instead of replacing it.',
  },
  {
    key: 'd',
    title: 'The recording explains itself',
    body: 'Trace ids live inside the rrweb stream, not in a side table. Export a session to a file, hand it to someone else, and it still resolves to its spans.',
  },
  {
    key: 'e',
    title: 'Masked by default',
    body: 'Inputs are masked unless you opt out. Query values are stripped from recorded URLs and fragments dropped entirely. Headers and request bodies are never captured at all.',
  },
  {
    key: 'f',
    title: 'Your infrastructure',
    body: 'Postgres, Redis, and any S3-compatible store. Session recordings are the most sensitive telemetry you will ever collect, and none of it leaves your network.',
  },
];

const VIEWER = [
  {
    title: 'Three strata, one clock',
    body: 'Network, backend and database lanes are drawn beneath the replay and read the player’s own time every frame. The video is the master clock, so nothing can drift out from under it.',
  },
  {
    title: 'Click a request to zoom',
    body: 'Selecting a bar focuses the timeline on that request with room either side, and one control returns you to the whole recording.',
  },
  {
    title: 'The full span, not a summary',
    body: 'Every attribute the span carried — db.statement, the HTTP status, the service that served it, the trace id — is there to read, not rolled up into an average.',
  },
  {
    title: 'An honest error bar',
    body: 'When the round trip to the browser was slow enough for the two clocks to disagree, the viewer draws the uncertainty band rather than a confidently wrong line.',
  },
];

const BACKEND_ENV = `# any OpenTelemetry exporter, any language
OTEL_EXPORTER_OTLP_ENDPOINT=https://syncline.example.com/v1/ingest
OTEL_EXPORTER_OTLP_HEADERS=x-syncline-key=sk_live_...`;

const FRONTEND_SNIPPET = `import { startRecording } from '@syncline/browser';

startRecording({
  key: 'pk_live_...',
  endpoint: 'https://syncline.example.com',
  traceOrigins: ['https://api.acme.com'],
});`;

function Kicker({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-2.5 font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
      <span className="text-foreground">{n}.</span>
      {children}
    </p>
  );
}

function Heading({ lead, beat }: { lead: string; beat: string }) {
  return (
    <h2 className="max-w-2xl text-[clamp(1.6rem,2.8vw,2.15rem)] font-semibold">
      {lead} <em className="text-muted-foreground not-italic">{beat}</em>
    </h2>
  );
}

export default function Landing() {
  return (
    <SiteShell>
      <SectionRail sections={SECTIONS} />

      <main>
        {/* ----------------------------------------------------------------- hero */}
        <section id="top" className="relative overflow-hidden">
          {/*
           * The only decoration on the page, plus its echo in the closing band. The grid is masked
           * to a soft ellipse so it fades rather than ending on a hard edge, and the glow sits
           * behind the headline, where the eye lands first.
           */}
          <div
            aria-hidden="true"
            className="grid-backdrop pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-[-20%] left-1/2 h-[520px] w-[900px] max-w-[140vw] -translate-x-1/2 rounded-full blur-3xl"
            style={{ background: 'var(--glow)' }}
          />

          <div className="relative mx-auto max-w-4xl px-6 pt-20 pb-16 text-center sm:pt-28">
            <Reveal>
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase backdrop-blur">
                <span className="bg-backend size-1.5 rounded-full" />
                Open source · self-hosted · AGPL-3.0
              </div>
            </Reveal>

            <Reveal delay={0.05}>
              <h1 className="text-[clamp(2.3rem,5vw,3.4rem)] font-bold tracking-[-0.045em]">
                Every layer of your stack, folded onto{' '}
                <em className="text-backend not-italic">one timeline</em>.
              </h1>
            </Reveal>

            <Reveal delay={0.1}>
              <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                Syncline replays a user session as video{' '}
                <span className="text-foreground">and</span> the backend
                distributed trace <span className="text-foreground">and</span>{' '}
                the SQL queries that ran — on one synchronized scrubber.
              </p>
            </Reveal>

            <Reveal delay={0.15}>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Button asChild size="lg">
                  <Link href="/docs/quickstart">
                    Quickstart
                    <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <a href={REPO} rel="noreferrer">
                    View source
                    <ArrowUpRight />
                  </a>
                </Button>
              </div>
            </Reveal>
          </div>

          <div className="relative mx-auto max-w-4xl px-6 pb-24">
            <Reveal delay={0.2}>
              <Fold />
            </Reveal>
          </div>
        </section>

        {/* ----------------------------------------------------------------- seam */}
        <section id="seam" className="border-t">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
            <Reveal>
              <Kicker n="I">The problem</Kicker>
              <Heading lead="Three tools." beat="One clock." />
            </Reveal>

            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
              {SEAM.map((item, i) => (
                <Reveal key={item.label} delay={i * 0.08}>
                  <div className="flex h-full flex-col gap-3 bg-background p-6">
                    <span
                      className={`font-mono text-[10px] tracking-[0.16em] uppercase ${
                        item.accent ? 'text-network' : 'text-muted-foreground'
                      }`}
                    >
                      {item.label}
                    </span>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------------- stitch */}
        <section id="stitch" className="border-t bg-muted/25">
          <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
            <Reveal>
              <Kicker n="II">How the stitch works</Kicker>
              <Heading lead="Four steps." beat="None of them yours." />
            </Reveal>

            <ol className="relative mt-10 flex flex-col gap-8">
              {/* The connector runs behind the numerals, tying four steps into one sequence. */}
              <span
                aria-hidden="true"
                className="absolute top-3 bottom-3 left-[11px] w-px bg-border"
              />
              {STEPS.map((step, i) => (
                <Reveal as="li" key={step.n} delay={i * 0.08}>
                  <div className="grid grid-cols-[34px_1fr] gap-4">
                    <span className="z-10 font-mono text-[11px] leading-6 text-muted-foreground">
                      <span className="bg-muted/25 pr-1">{step.n}</span>
                    </span>
                    <div className="leading-6">
                      <strong className="text-sm font-semibold">
                        {step.title}
                      </strong>{' '}
                      <span className="text-sm text-muted-foreground">
                        {step.body}
                      </span>
                    </div>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------- integration */}
        <section id="integration" className="border-t">
          <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
            <Reveal>
              <Kicker n="III">The whole integration</Kicker>
              <Heading lead="No backend SDK." beat="Ever." />
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
                If your services already emit OpenTelemetry, the backend change
                is two environment variables.
              </p>
            </Reveal>

            <Reveal delay={0.1}>
              <Tabs defaultValue="frontend" className="mt-8 gap-4">
                <TabsList>
                  <TabsTrigger value="frontend">Frontend</TabsTrigger>
                  <TabsTrigger value="backend">Backend</TabsTrigger>
                </TabsList>

                <TabsContent value="frontend">
                  <CodeBlock
                    plain={FRONTEND_SNIPPET}
                    caption="Once, at the top level"
                  >
                    <K>import</K> {'{ startRecording }'} <K>from</K>{' '}
                    <S>&apos;@syncline/browser&apos;</S>;{'\n\n'}
                    startRecording({'{'}
                    {'\n  '}key: <S>&apos;pk_live_...&apos;</S>,{'\n  '}
                    endpoint: <S>&apos;https://syncline.example.com&apos;</S>,
                    {'\n  '}traceOrigins: [
                    <S>&apos;https://api.acme.com&apos;</S>],{'\n'}
                    {'}'});
                  </CodeBlock>
                </TabsContent>

                <TabsContent value="backend">
                  <CodeBlock
                    plain={BACKEND_ENV}
                    caption="Any OTel exporter, any language"
                  >
                    <C># any OpenTelemetry exporter, any language</C>
                    {'\n'}
                    <K>OTEL_EXPORTER_OTLP_ENDPOINT</K>=
                    <S>https://syncline.example.com/v1/ingest</S>
                    {'\n'}
                    <K>OTEL_EXPORTER_OTLP_HEADERS</K>=
                    <S>x-syncline-key=sk_live_...</S>
                  </CodeBlock>
                </TabsContent>
              </Tabs>
            </Reveal>
          </div>
        </section>

        {/* ----------------------------------------------------------- properties */}
        <section id="properties" className="border-t bg-muted/25">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
            <Reveal>
              <Kicker n="IV">What makes it different</Kicker>
              <Heading lead="Six decisions." beat="Each one load-bearing." />
            </Reveal>

            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-2 lg:grid-cols-3">
              {PROPERTIES.map((p, i) => (
                <Reveal key={p.title} delay={(i % 3) * 0.08}>
                  <div className="group ease-brand relative h-full bg-background p-6 transition-colors duration-300 hover:bg-card">
                    <span
                      aria-hidden="true"
                      className="ease-brand bg-network absolute inset-x-0 top-0 h-px scale-x-0 transition-transform duration-500 group-hover:scale-x-100"
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {p.key}.
                    </span>
                    <h3 className="mt-2 font-display text-sm font-semibold tracking-tight">
                      {p.title}
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                      {p.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------------- viewer */}
        <section id="viewer" className="border-t">
          <div className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
            <Reveal>
              <Kicker n="V">In the viewer</Kicker>
              <Heading lead="Drag to 00:42." beat="See all of it at once." />
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                The user clicked Checkout, that fired POST /api/checkout, which
                fanned out to four spans, one of which was a query that took 1.8
                seconds. One scrubber, one answer.
              </p>
            </Reveal>

            <div className="mt-8 divide-y rounded-lg border">
              {VIEWER.map((item, i) => (
                <Reveal key={item.title} delay={i * 0.06}>
                  <div className="grid gap-1.5 px-5 py-5 sm:grid-cols-[13rem_1fr] sm:gap-6">
                    <h3 className="font-display text-sm font-semibold">
                      {item.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------ cta */}
        <section className="relative overflow-hidden border-t">
          <div
            aria-hidden="true"
            className="grid-backdrop pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_50%_60%_at_50%_100%,black,transparent)]"
          />
          <div className="relative mx-auto max-w-3xl px-6 py-24 text-center">
            <Reveal>
              <h2 className="text-[clamp(1.9rem,4vw,2.7rem)] font-semibold tracking-[-0.04em]">
                Running in about{' '}
                <em className="text-backend not-italic">five minutes</em>.
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Docker for Postgres, Redis and MinIO. Three Node processes. One
                seeded project key.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button asChild size="lg">
                  <Link href="/docs/quickstart">
                    Read the quickstart
                    <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/docs/architecture">How it is built</Link>
                </Button>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
