# syntax=docker/dockerfile:1.7
# Backend image. One image, two roles:
#   API:      node dist/main.js                                  (default CMD)
#   migrate:  node dist/scripts/migrate.js up && node dist/seed/seed.js   (compose one-shot)

ARG NODE_VERSION=24.19.0

# ---- base: shared settings --------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# ---- deps: full dependency tree for compiling --------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ---- build: compile TypeScript to dist/ ---------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: runtime dependencies only (no compiler, test or lint tooling) -----------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---- runtime -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app

# Files stay owned by root and are only readable by the `node` user the process runs as,
# so a compromised process cannot rewrite its own code. package.json is required at runtime:
# it declares "type": "module" for the ESM build.
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations

USER node
EXPOSE 3001

# Liveness only (no database round-trip), so a database blip does not get containers killed.
# slim images have no curl; Node's built-in fetch does the job.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/v1/health/live`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# exec form: node is the process that receives SIGTERM (compose adds an init via `init: true`).
CMD ["node", "dist/main.js"]
