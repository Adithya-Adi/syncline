# Example: a storefront that records itself

A working Syncline integration in a Next.js app. It exists for two reasons:

- **To see what Syncline is for.** Click a button, open the recording, and the click, the request it
  made, the server span it caused, and the database query underneath that span are all on one
  timeline against one clock.
- **To test Syncline while developing it.** It produces real sessions, real request links, real
  traces, failing requests, slow requests, and identifiable users — which is what the dashboard, the
  setup doctor, and session search all need in order to be tested at all.

The whole integration is `app/recording.tsx`, which is the Next.js snippet the dashboard's setup page
hands out, pasted in unchanged. Everything else is a storefront to click on.

## What it exercises

| Feature                 | How                                                                   |
| ----------------------- | --------------------------------------------------------------------- |
| rrweb session replay    | The recorder starts in the root layout and survives client navigation |
| Request → trace linking | `fetch` is patched by the SDK; every call carries a `traceparent`     |
| Backend spans           | Route handlers continue the browser's trace and export OTLP/JSON      |
| Database lane           | Spans carry `db.system` and `db.statement`                            |
| Failed requests         | `GET /api/inventory` returns 500 with a failing DB span               |
| Slow requests           | `GET /api/slow` spends ~1.2s in a sequential scan                     |
| Client errors           | Checkout with an empty cart returns 422                               |
| Route changes           | `next/link` between `/`, `/cart`, `/orders` — one continuous session  |
| Requests with no trace  | Next's own `?_rsc` navigation fetches appear with no backend spans    |
| User identity           | The user id is editable, so a specific session can be found again     |
| Clock calibration       | Spans are timestamped from a monotonic clock anchored to the epoch    |
| The CORS failure        | `BREAK_CORS=1` reproduces the missing `traceparent` allow-header      |

## Running it

1. **Infrastructure and services.** From the repository root:

   ```sh
   pnpm infra:up          # postgres, redis, minio
   pnpm db:migrate:dev
   pnpm dev               # api, worker, web
   ```

2. **A project to record into.** Sign in at <http://localhost:3000>, create a project, and add
   `http://localhost:4321` to its allowed origins. The secret key is shown once, when the project is
   created — copy it then.

   Or mint one from the command line, which prints both keys and allowlists this example's origin:

   ```sh
   pnpm db:seed
   ```

   The seed joins the newest organization that has members. Pass `SEED_ORGANIZATION=<id|slug>` if
   that guesses wrong — a project in an organization you are not a member of ingests recordings and
   shows none of them.

3. **Configure and run.**

   ```sh
   cp examples/storefront/.env.example examples/storefront/.env.local
   # fill in NEXT_PUBLIC_SYNCLINE_PUBLIC_KEY and SYNCLINE_SECRET_KEY
   pnpm nx run example-storefront:dev
   ```

   Then open <http://localhost:4321> and click things. The first chunk is uploaded within about five
   seconds; the recording appears under the project in the dashboard.

The `dev` target builds the browser SDK first, because `syncline-browser` is linked as a workspace
package and its entry point is the built bundle.

## Which key goes where

`NEXT_PUBLIC_SYNCLINE_PUBLIC_KEY` is prefixed because it is meant to reach the browser — that is what
makes it public, and it is safe there because ingest gates it on the project's origin allowlist.
`SYNCLINE_SECRET_KEY` has no prefix, so Next refuses to inline it into client code; it is read only
inside route handlers, which is where the spans are exported from.

## Reproducing the CORS failure

`traceparent` makes a request non-simple, so the API it is sent to must name that header in
`Access-Control-Allow-Headers`. When it does not, every traced request fails its preflight and it
looks like Syncline broke the application.

```sh
BREAK_CORS=1 pnpm nx run example-storefront:dev
```

Requests from the storefront itself keep working — the page and the API share an origin, so no
preflight happens. A cross-origin probe does not, which is what the setup page's **Check your own
API's CORS** panel detects: point it at `http://localhost:4321/api/products` with and without the
flag set.

## What is not idiomatic here

`lib/otlp.ts` builds the OTLP payload by hand. A real service should not: set
`OTEL_EXPORTER_OTLP_ENDPOINT` to `<endpoint>/v1/ingest` and let the OpenTelemetry SDK do it. It is
hand-written so the example needs no dependency beyond Next itself, and so the wire format Syncline
accepts is visible in one readable file.
