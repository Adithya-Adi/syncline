# syncline-browser

The recorder that ships to a customer's site. It records the session with
[rrweb](https://github.com/rrweb-io/rrweb) and writes trace ids into the recording as it goes, so
a replay can resolve to its backend spans without a side table.

## Install

Install the alpha prerelease with:

    npm install syncline-browser

This package is currently an alpha prerelease. The supported public API is startRecording and the
SynclineOptions type while the SDK integration surface is being validated.

Documentation and the hosted Syncline application will be available at
[syncline.adiverse.org](https://syncline.adiverse.org). The endpoint remains configurable for
self-hosted installations.

```ts
import { startRecording } from 'syncline-browser';

startRecording({
  key: 'pk_live_...',
  endpoint: 'https://syncline.example.com',
  traceOrigins: ['https://app.acme.com', 'https://api.acme.com'],
  release: 'web@2.4.1',
  user: { id: currentUser.id },
});
```

## The rules this code is written around

**Never break the page.** Every patched path is wrapped, and any failure inside the SDK falls
through to the original `fetch` or `XMLHttpRequest`. A recording tool that takes down checkout is
worse than no recording tool. There is a test for this: when both instrumentation hooks throw, the
request still completes.

**Never inject cross-origin.** `traceparent` goes only to origins on `traceOrigins`, which defaults
to the page's own origin. Sending it to a third party would leak internal trace ids and add a
header their CORS policy does not allow — turning a working request into a failed preflight.
Subdomains do not match, because a third-party widget can be parked on one.

**Never trace itself.** `window.fetch` is captured before the patch is installed, so the SDK's own
uploads and clock probes carry no header and never appear in their own recording.

**Mask by default.** `maskAllInputs` is on unless you turn it off. Query _values_ are stripped from
recorded URLs and only keys kept — `?token=abc&page=2` becomes `?token&page`. Fragments are dropped
entirely, since implicit-flow tokens live there.

Escape hatches for the host page: `.syncline-block` on an element keeps its subtree out of the
recording; `.syncline-mask` keeps the structure but replaces the text.

## Details worth knowing

**Sampling is inverted.** A recorded session always sets `sampled=1` on the traceparent, so a
replay can never exist without the spans that explain it.

**Two custom events per request**, `syncline.request` and `syncline.response`, correlated by span
id. rrweb's log is append-only, so a duration cannot be stamped onto an event already emitted.

**Requests in flight at a flush boundary** roll into a later chunk rather than being reported with a
guessed duration.

**The session id lives in `sessionStorage`** with a 30-minute idle timeout. It survives navigation
within a tab but not a new tab — two tabs are two recordings, and merging them would produce a
replay whose DOM jumps between windows.

**Uploads use `fetch` with `keepalive: true`** on `pagehide` rather than `sendBeacon`, which cannot
set headers and would push the API key into a query string. Keepalive bodies are capped at 64 KB
across all in-flight requests, which is where the flush threshold comes from.

## Release checklist

Build and inspect the exact npm artifact from the repository root:

    pnpm nx build browser-sdk
    cd packages/browser-sdk
    npm pack --dry-run

The package bundles the internal protocol and runtime dependencies, so consumers only need this
package. Publish prereleases with:

    npm publish --tag next

## Options

| Option          | Default     |                                        |
| --------------- | ----------- | -------------------------------------- |
| `key`           | —           | Public project key, `pk_*`             |
| `endpoint`      | —           | Syncline API base URL                  |
| `traceOrigins`  | page origin | Origins that receive a `traceparent`   |
| `release`       | —           | Ties a replay to a deploy              |
| `user`          | —           | `{ id }`                               |
| `maskAllInputs` | `true`      | Masks every input, textarea and select |
| `debug`         | `false`     | SDK diagnostics to the console         |

## The one thing an integrator has to do

The API being called must allow the header:

```
Access-Control-Allow-Headers: traceparent
```

This is the single most common integration failure. Without it, every traced request fails
preflight — and it looks like the SDK broke the site rather than like a CORS setting.
