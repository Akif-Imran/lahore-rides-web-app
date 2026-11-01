# syntax=docker/dockerfile:1.7
# Frontend image: the Next.js standalone server (`node server.js`).
#
# NEXT_PUBLIC_API_BASE_URL is inlined into the browser bundle at *build* time, so it is a build
# argument, not a runtime variable. It must be the API URL as the user's browser sees it, and
# changing it needs a rebuild.

ARG NODE_VERSION=24.19.0

# ---- base: shared settings --------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NEXT_TELEMETRY_DISABLED=1

# ---- deps: full dependency tree for building ----------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ---- build: `next build` with standalone output -------------------------------------------
FROM deps AS build
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
# Only what the app build needs. Tests stay out: they import the backend's seed file, which is
# not part of this build context.
COPY next.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime: standalone server only (no build tooling, no full node_modules) -------------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# Files stay owned by root and are only readable by the `node` user the process runs as, so a
# compromised process cannot rewrite its own code. The standalone output does not include the
# static assets; they are copied next to it as Next expects.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

USER node
EXPOSE 3000

# alpine has wget, but Node's built-in fetch keeps both images' checks identical.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# exec form: node is the process that receives SIGTERM (compose adds an init via `init: true`).
CMD ["node", "server.js"]
