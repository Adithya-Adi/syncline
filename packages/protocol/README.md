# @syncline/protocol

Every contract that crosses a process boundary in Syncline, in one place: the browser SDK, the
ingest API, the worker, and the viewer all import their types from here.

It has no runtime dependencies beyond zod and imports nothing from the rest of the workspace, so
it stays a leaf in the dependency graph.

| Module | What |
| --- | --- |
| `ids.ts` | W3C trace context — id generation, validation, `traceparent` format and parse |
| `events.ts` | The rrweb custom events that carry trace ids inside the replay stream |
| `ingest.ts` | Browser → API wire schemas (zod) |
| `read.ts` | API → viewer response types |
| `jobs.ts` | Queue payloads shared by `apps/api` and `apps/worker` |
| `keys.ts` | `pk_*` / `sk_*` key shapes |
| `limits.ts` | Ingest limits and SDK flush tuning, agreed by both sides |

Two conventions worth knowing before adding to it:

**Validate at the boundary, not everywhere.** `ingest.ts` uses zod because it parses
attacker-controlled input. `read.ts` is plain types because the server authors that data —
validating it would only be checking our own work.

**Objects strip unknown keys rather than rejecting them.** A deployed server has to keep accepting
chunks from a newer SDK that added a field. Tightening this would turn every SDK release into a
coordinated deploy.

Timestamps on the wire are epoch milliseconds as JSON numbers. OpenTelemetry's nanoseconds are
carried as strings and only ever converted server-side — see `docs/ARCHITECTURE.md` §6.
