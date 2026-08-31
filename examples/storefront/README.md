# Example: a storefront that records itself

A working Syncline integration in about 250 lines, with no dependencies of its own. It exists for
two reasons:

- **To see what Syncline is for.** Click a button, open the recording, and the click, the request it
  made, the server span it caused, and the database query underneath that span are all on one
  timeline against one clock.
- **To test Syncline while developing it.** It produces real sessions, real request links, real
  traces, failing requests, slow requests, and identifiable users — which is what the dashboard,
  the setup doctor, and session search all need in order to be tested at all.

## What it exercises

| Feature                 | How                                                                      |
| ----------------------- | ------------------------------------------------------------------------ |
| rrweb session replay    | The page records itself from the first paint                             |
| Request → trace linking | `fetch` is patched by the SDK; every call carries a `traceparent`        |
| Backend spans           | The server continues the browser's trace and exports OTLP/JSON           |
| Database lane           | Spans carry `db.system` and `db.statement`                               |
| Failed requests         | `GET /api/inventory` returns 500 with a failing DB span                  |
| Slow requests           | `GET /api/slow` spends ~1.2s in a sequential scan                        |
| Client errors           | `POST /api/checkout` with an empty cart returns 422                      |
| Route changes           | The nav uses `history.pushState`                                         |
| User identity           | The user id is editable, so a specific session can be found again        |
| Clock calibration       | The server timestamps spans from a monotonic clock anchored to the epoch |
| The CORS failure        | `BREAK_CORS=1` reproduces the missing `traceparent` allow-header         |

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

3. **Configure and run.**

   ```sh
   cp examples/storefront/.env.example examples/storefront/.env
   # fill in SYNCLINE_PUBLIC_KEY and SYNCLINE_SECRET_KEY
   pnpm nx run example-storefront:start
   ```

   Then open <http://localhost:4321> and click things. The first chunk is uploaded within about five
   seconds; the recording appears under the project in the dashboard.

The `start` target builds the browser SDK first, because the page loads the bundle that build
produces — that is the "script tag" install path from the setup page, served from
`/js/syncline.js`.

## Reproducing the CORS failure

`traceparent` makes a request non-simple, so the API it is sent to must name that header in
`Access-Control-Allow-Headers`. When it does not, every traced request fails its preflight and it
looks like Syncline broke the application.

```sh
BREAK_CORS=1 pnpm nx run example-storefront:start
```

Requests from the storefront itself keep working — the page and the API share an origin, so no
preflight happens. A cross-origin probe does not, which is what the setup page's **Check your own
API's CORS** panel detects: point it at `http://localhost:4321/api/products` with and without the
flag set.

## What is not idiomatic here

`otlp.mjs` builds the OTLP payload by hand. A real service should not: set
`OTEL_EXPORTER_OTLP_ENDPOINT` to `<endpoint>/v1/ingest` and let the OpenTelemetry SDK do it. It is
hand-written here so the example installs nothing, and so the wire format Syncline accepts is
visible in one readable file.
