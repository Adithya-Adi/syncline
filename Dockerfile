# Syncline images: one Dockerfile, three targets.
#
#   docker build --target api    -t syncline/api    .
#   docker build --target worker -t syncline/worker .
#   docker build --target web    -t syncline/web    .
#
# One file rather than three because the expensive layers — the pnpm store, the workspace install,
# the Prisma client — are identical for all three. Three Dockerfiles would install the monorepo
# three times and then drift from each other.
#
# Migrations are deliberately not run at container start. A dozen replicas booting at once would
# race each other through the same migration, and a failed one would take the whole rollout down
# rather than one job. Run `pnpm db:migrate` once, from a release job or by hand, before rolling.
# The `migrate` target below exists for exactly that.

FROM node:22-alpine AS base
# libc6-compat: Prisma's query engine is glibc-linked, and Alpine is musl.
RUN apk add --no-cache libc6-compat
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------------------------
# Dependencies. Copied before the source so a code change does not reinstall the workspace.
# ---------------------------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/models/package.json ./packages/models/
COPY packages/storage/package.json ./packages/storage/
COPY packages/otlp/package.json ./packages/otlp/
COPY packages/browser-sdk/package.json ./packages/browser-sdk/
COPY examples/storefront/package.json ./examples/storefront/
# `--ignore-scripts`, because postinstall runs `prisma generate` and the schema is not copied yet.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------------------------
# Build. Every target builds from here, so the Prisma client is generated exactly once.
# ---------------------------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm exec prisma generate
# NX_DAEMON off: the daemon is a long-lived process and there is nothing here to keep it alive for.
ENV NX_DAEMON=false
# Better Auth warns loudly when its secret is unset, and the web build evaluates page modules.
# Build-time only and deliberately not a real secret — the running container reads its own.
ENV BETTER_AUTH_SECRET=build-time-only-not-a-real-secret

# Where this install will answer, needed *here* rather than at runtime.
#
# The landing page and the docs are statically rendered, and Next resolves their metadata at build
# — so the canonical URL, og:url and the social card's address are frozen into the HTML now. A
# runtime environment variable arrives far too late to affect them, and the fallback that gets
# baked in instead is `http://localhost:3000`: a canonical pointing at a host no crawler can reach,
# which is worse for the site than having no canonical at all.
#
# Not a secret. It is the public address of the site, and it ends up in the served HTML by design.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

RUN pnpm exec nx run-many -t build --projects=api,worker,web

# ---------------------------------------------------------------------------------------------
# api — authenticates, stores the raw body, enqueues, returns 202. Parses nothing.
# ---------------------------------------------------------------------------------------------
FROM base AS api
ENV NODE_ENV=production
# Both trees. pnpm puts a package's own dependencies under its own node_modules, linked into the
# root store, so a bundle's external requires resolve through the app-level directory and the store
# it points at. Copying only the root gives MODULE_NOT_FOUND at runtime rather than at build.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages ./packages
WORKDIR /app/apps/api
# Nothing in the image needs to write. Run unprivileged, as the node user the image already has.
USER node
EXPOSE 4000
# No shell form, so signals reach node directly and the graceful shutdown actually runs.
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------------------------
# worker — decompresses, validates, normalizes, indexes. The expensive half.
# ---------------------------------------------------------------------------------------------
FROM base AS worker
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/packages ./packages
WORKDIR /app/apps/worker
USER node
# No port: it consumes queues and serves nothing. Liveness is "the process is up"; whether it is
# keeping up is a queue-depth question, which belongs on the queue rather than on an HTTP probe.
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------------------------
# web — the dashboard and the viewer. Holds the secret key server-side.
# ---------------------------------------------------------------------------------------------
FROM base AS web
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/apps/web/next.config.js ./apps/web/
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/packages ./packages
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]

# ---------------------------------------------------------------------------------------------
# migrate — a one-shot job, not a service.
#
# Kept as its own target so a release can run migrations without shipping the Prisma CLI inside the
# images that serve traffic, and without any of them being tempted to run migrations on boot.
# ---------------------------------------------------------------------------------------------
FROM build AS migrate
ENV NODE_ENV=production
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]
