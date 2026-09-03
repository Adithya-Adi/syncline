<h1 align="center">Syncline</h1>

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
the _seam_, so "a user said checkout was slow" is still archaeology — you eyeball a video, guess a
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

Self-hostable, and in use. Building in the open, milestone by milestone:

- [x] **M0** — repo, architecture, scaffold
- [x] **M1** — browser SDK captures, chunks land in Postgres
- [x] **M2** — OTLP ingest, trace stitching, the read API, the viewer
- [x] **M3** — accounts, organizations, roles, the seeded demo recording
- [x] **M4** — errors and console capture, `identify()`/`setContext()`, recordings search
- [ ] **M5** — ~~retention~~, project deletion, an audit log

Deploy it with `docker-compose.prod.yml` — see [self-hosting](#self-hosting) below. Retention is
there and off by default; what is not: no way to delete a project, no audit log.

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

| Path                   | What                                    |
| ---------------------- | --------------------------------------- |
| `apps/api`             | Ingest + query API (NestJS)             |
| `apps/worker`          | Queue processors (NestJS standalone)    |
| `apps/web`             | Viewer and landing page (Next.js)       |
| `packages/browser-sdk` | The recorder that ships to users' sites |
| `packages/protocol`    | Shared wire types                       |
| `packages/models`      | Prisma schema and client                |
| `packages/otlp`        | OTLP → internal span normalizer         |

## Development

```sh
pnpm install
pnpm infra:up      # postgres, redis, minio
pnpm db:migrate
pnpm db:seed       # prints the project's pk_ / sk_ keys, and installs a demo recording
```

Then run the three processes:

```sh
node apps/api/dist/main.js       # :4000
node apps/worker/dist/main.js
pnpm nx dev web                  # :3000
```

The landing page is at `/`; a recording is at `/s/<sessionId>`. The seed installs one — a
three-page checkout that ends in a failed payment, with the trace underneath it — so the viewer has
something in it before the SDK is wired into anything. `SEED_DEMO=false` skips it.

That recording is a fixture, and it was made by the real SDK driving real rrweb under jsdom rather
than written by hand. Regenerate it with:

```sh
pnpm nx build browser-sdk
node tools/build-demo-recording.mjs
```

Ports 5442 and 6399 are deliberate — if you already run Postgres or Redis
natively, the standard ports are taken, and a host connection can reach your own
server instead of the container with nothing to tell you so.

## Self-hosting

Three Node processes — `api`, `worker`, `web` — plus Postgres, Redis and anything that speaks S3.
One `Dockerfile` builds all three, and a `migrate` target runs to completion before any of them
start:

```sh
cp .env.production.example .env.production   # nothing has a working default
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Point `DATABASE_URL`, `REDIS_URL` and `S3_ENDPOINT` at managed services and that is the whole
deployment. For a single box with none of those, `--profile bundled` brings up Postgres, Redis and
MinIO alongside. Put it behind a proxy that terminates TLS — the session cookies are `secure`.

Migrations never run at container start: a dozen replicas booting together would race through the
same migration, and one failing would take a rollout down rather than one job.

**Retention.** `RETENTION_DAYS` on the worker deletes sessions older than that — their chunks in
the object store, the spans nothing else points at, and the raw OTLP bodies — sweeping every
`RETENTION_INTERVAL_MINUTES` (default 60). It is `0` out of the box, which keeps everything
forever, and has no upper bound: set `3650` if ten years is the policy. Deletion is permanent.

**Roles.** Membership decides what somebody can see, their role decides what they can change.
Members read; admins run projects — settings, key rotation, search keys, invitations; owners
additionally delete. Every mutation checks on the server.

## License

[AGPL-3.0](LICENSE). Self-host it freely, modify it freely. If you run a modified Syncline as a
network service, you share those modifications.
