

The landing page is at , and a recording at .<h1 align="center">Syncline</h1>

<p align="center"><strong>Every layer of your stack, folded onto one timeline.</strong></p>

<p align="center">
  <a href="#status"><img alt="status" src="https://img.shields.io/badge/status-pre--alpha-orange"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
</p>

---

Syncline replays a user session as video **and** the backend distributed trace **and** the SQL
queries that ran — on one synchronized scrubber.

Drag to `00:42`, and you see all of it at once: the user clicked **Checkout**, that fired
`POST /api/checkout`, which fanned out to four spans, one of which was a Prisma query that took
1.8 seconds.

## Why

Session replay tools show you the browser. Tracing tools show you the backend. Neither shows you
the *seam*, so "a user said checkout was slow" is still archaeology — you eyeball a video, guess a
timestamp, then go hunting in a separate tool with a different clock.

Syncline stitches the two into a single timeline.

## How it works

1. The browser SDK records the session with [rrweb](https://github.com/rrweb-io/rrweb) and patches
   `fetch`/`XHR` to mint a W3C `traceparent` for every outgoing request.
2. That trace ID is written **into the replay stream itself** as an rrweb custom event, at the exact
   frame the request fired. The recording is self-describing.
3. Your backend needs no Syncline SDK. Standard OpenTelemetry auto-instrumentation reads the
   incoming `traceparent` and continues the trace. You point `OTEL_EXPORTER_OTLP_ENDPOINT` at
   Syncline and that's the integration.
4. The viewer resolves player time → trace ID → span tree, and draws the backend lanes underneath
   the video.

Two design notes worth calling out:

- **The link is by ID, not by time.** Clock skew between browser and server can misdraw a lane by a
  few milliseconds, but it can never mis-attribute a request to the wrong trace.
- **Sampling is inverted.** If a session is being recorded, the browser forces `sampled=1` on the
  traceparent. You never end up with a replay whose spans were sampled away.

## Status

Pre-alpha. Nothing is installable yet. Building in the open, milestone by milestone:

- [x] **M0** — repo, architecture, scaffold
- [x] **M1** — browser SDK captures, chunks land in Postgres
- [x] **M2** — OTLP ingest, trace stitching, the read API, the viewer
- [ ] **M3** — demo recording, clock-skew band against real latency, README gif

## Architecture

```
browser                        your backend
┌──────────────┐               ┌──────────────┐
│ syncline-sdk │               │ your app     │
│ rrweb capture│  traceparent  │ + OTel SDK   │
│ fetch patch  ├──────────────►│              │
└──────┬───────┘               └──────┬───────┘
       │ rrweb chunks + links         │ OTLP/HTTP
       ▼                              ▼
   ┌────────────────────────────────────────┐
   │ apps/api      thin, validates, 202     │
   └───────────────┬────────────────────────┘
                   │ BullMQ
   ┌───────────────▼────────────────────────┐
   │ apps/worker   parse → normalize → store│
   └──────┬──────────────────┬──────────────┘
          ▼                  ▼
     Postgres           object store
          ▲
   ┌──────┴──────────────────┐
   │ apps/web      the viewer│
   └─────────────────────────┘
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the ingest schema, the stitching protocol,
and the data model.

## Repository

Nx monorepo, pnpm, TypeScript.

| Path | What |
| --- | --- |
| `apps/api` | Ingest + query API (NestJS) |
| `apps/worker` | Queue processors (NestJS standalone) |
| `apps/web` | Viewer and landing page (Next.js) |
| `packages/browser-sdk` | The recorder that ships to users' sites |
| `packages/protocol` | Shared wire types |
| `packages/models` | Prisma schema and client |
| `packages/otlp` | OTLP → internal span normalizer |

## Development

```sh
pnpm install
pnpm infra:up      # postgres, redis, minio
pnpm dev
```

## License

[AGPL-3.0](LICENSE). Self-host it freely, modify it freely. If you run a modified Syncline as a
network service, you share those modifications.
