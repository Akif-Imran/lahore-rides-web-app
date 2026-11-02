# Ride booking (Lahore)

A simplified ride-hailing app for Lahore. A rider picks a pickup and a destination, compares Economy and Comfort fares with a pickup ETA, requests a ride and follows it live. Drivers go online, accept, start and complete rides. Under the hood, the backend guarantees that **one ride gets exactly one driver**, that **retries never create duplicate rides**, and that **rides only move through legal states**.

**Stack:** Next.js 16 (TypeScript) · Nest.js 12 (TypeScript) · PostgreSQL 16 · Docker Compose

| I want to… | Go to |
|---|---|
| Run it in one command | [Quick start](#31-quick-start-one-command) |
| Understand the design decisions | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (the eight architecture answers, diagrams, limitations) |
| Learn the modules and request flows | [docs/SYSTEM_GUIDE.md](docs/SYSTEM_GUIDE.md) (glossary, modules, green and red paths per endpoint) |
| Call the API | [API by example](#42-api-by-example) or Swagger UI at http://localhost:3001/docs |

## Contents
1. [Prerequisites checklist](#1-prerequisites-checklist)
2. [Features](#2-features)
3. [Setup](#3-setup): [one command](#31-quick-start-one-command) · [manual Docker](#32-manual-setup-with-docker) · [local development](#33-local-development-apps-on-the-host) · [environment variables](#34-environment-variables) · [everyday commands](#35-everyday-commands) · [troubleshooting](#36-troubleshooting)
4. [Using the app](#4-using-the-app)
5. [NPM scripts reference](#5-npm-scripts-reference)
6. [Testing and reliability](#6-testing-and-reliability)
7. [Continuous integration](#7-continuous-integration) · [Repository layout](#8-repository-layout) · [Documentation](#9-documentation)

---

## 1. Prerequisites checklist

**Verify every item before running any setup command or script.** `./setup.sh` re-checks the required ones and stops with a specific fix if anything is missing, but checking first saves a round trip.

**Required to run the app:**

| ✓ | Requirement | Verify with | Expected |
|---|---|---|---|
| ☐ | A bash shell: macOS, Linux, or Windows **with WSL2** | `bash --version` | Any version (macOS's built-in 3.2 is fine) |
| ☐ | Git | `git --version` | Any recent version |
| ☐ | Docker Desktop (macOS, Windows) or Docker Engine (Linux) | `docker --version` | A version string |
| ☐ | Docker is **running** | `docker info` | Prints details, with no "Cannot connect" error |
| ☐ | Docker Compose v2.17 or newer | `docker compose version` | `2.17.0` or higher (new Docker Desktop releases report v2 or later) |
| ☐ | Ports 3000, 3001 and 5432 are free (or you will change them in `.env`) | `lsof -nP -iTCP:3000 -sTCP:LISTEN` (repeat for 3001, 5432) | No output |
| ☐ | Resources for Docker | Docker Desktop: Settings > Resources | 2 GB memory or more; about 3 GB of free disk for images |
| ☐ | Internet access for the first run | | The first build pulls the Node 24 and PostgreSQL 16 images and the npm packages |

**Required only for running the tests or the apps outside Docker:**

| ✓ | Requirement | Verify with | Expected |
|---|---|---|---|
| ☐ | Node.js 24 (LTS) with npm | `node --version` and `npm --version` | `v24.x` (the repo's `.nvmrc` says 24, so `nvm install && nvm use` works) |

**Optional:**

| Tool | Used for | Verify with |
|---|---|---|
| `make` | Shortcuts (`make setup`, `make e2e`, …); every target is also a plain command | `make --version` |
| `curl`, `jq`, `uuidgen` | The [API walkthrough](#42-api-by-example) | `curl --version`, `jq --version` |
| Chromium for Playwright | End-to-end tests; installed automatically by `make e2e` | |

---

## 2. Features

**For riders (http://localhost:3000)**
- Pick a pickup and destination from 12 Lahore landmarks, using search or the keyboard.
- Compare Economy and Comfort: the fare, its breakdown and the pickup ETA. "No drivers nearby" appears when no driver is close enough.
- Request a ride safely: double clicks and retries never book twice.
- Follow the ride live (requested, driver assigned, on trip, completed) with the driver's details, then get a receipt. A ride can be cancelled before the trip starts.
- After a refresh, "Resume your ride" brings the ride back.
- Every loading, empty and error state is handled.

**For drivers (http://localhost:3000/driver, a simulation console)**
- Go online or offline at a chosen position, see nearby requests, accept, start, complete or cancel.
- Open two tabs to race two drivers for the same ride.

**Under the hood (backend)**

| Capability | What it guarantees | How |
|---|---|---|
| **Ride state machine** | Rides only move `REQUESTED` → `ASSIGNED` → `IN_PROGRESS` → `COMPLETED`, or to `CANCELLED` / `EXPIRED`. Terminal states never change. Only the right party may make each move. | One pure transition table plus `decide*` functions. Impossible moves get `409`, the wrong party gets `403`, and a repeat by the same party gets `200` with no change. Every one of the 144 combinations is tested. |
| **Concurrency control** | Two drivers can never both win a ride; a driver can never hold two trips; a rider never has two active rides. | Four layers: row locks (`SELECT … FOR UPDATE`) in a fixed order (ride, then driver); compare-and-swap writes (`UPDATE … WHERE status = 'REQUESTED'`); partial unique indexes as a database-level backstop; and 3 s lock and 5 s statement timeouts, so contention fails fast with a retryable `503`. |
| **ACID transactions** | Every state change is all-or-nothing. A ride, its fare quote and its stored idempotency response are committed together, or not at all. | `TransactionManager.run()`: `BEGIN`, then the work, then `COMMIT`, with `ROLLBACK` on any error, on one connection, at READ COMMITTED. |
| **Idempotent ride requests** | Retrying a request, even after a lost response, returns the original ride instead of creating a second one. | An `Idempotency-Key` per intent, claimed in the same transaction as the ride. A retry is replayed with `200` and `Idempotent-Replayed: true`; the same key with a different body gets `422`. |
| **Simplified matching and fares** | Category rules (Comfort cars can take Economy rides), driver freshness, and nearest-driver ETA within 5 km. Fares are in whole rupees with a minimum. | Haversine distance in SQL with a bounding-box prefilter. The quote is stored at booking, so the receipt equals what the rider saw. |
| **Expiry sweeper** | A request nobody accepts expires after 5 minutes instead of waiting forever. | One conditional `UPDATE` every 30 s, safe to run on every replica at once. |
| **Rate limiting** | One caller cannot flood the API. | 120 calls per minute per caller, and 10 ride requests per minute, with `429` and `Retry-After`. |
| **Consistent errors** | Every failure has the same shape and a request id; internals never leak. | `{ "error": { "code", "message", "details?", "requestId" } }` from one global filter. |
| **Operational basics** | Easy to observe and deploy. | JSON logs with request ids, liveness and readiness endpoints, validated configuration, and non-root read-only containers with health checks. |
| **API contract** | The frontend and backend cannot silently drift apart. | OpenAPI (Swagger UI); frontend types are generated from it, and CI fails on any drift. |

---

## 3. Setup

### 3.1 Quick start: one command

```bash
git clone <repository-url> ride-booking
cd ride-booking
./setup.sh            # or: make setup
```

`setup.sh` runs five steps and stops with a clear message and fix if any of them fails:
1. **Checks prerequisites:**
   - Docker installed and running;
   - Docker Compose 2.17 or newer;
   - enough memory for Docker (a warning only);
   - Node.js, only if you asked for `--install-deps`.
2. **Creates the environment files** from their templates. Existing files are never overwritten. It then checks that the values are consistent with each other (ports, URLs, CORS):
   - `.env` for Docker Compose;
   - `backend/.env` for running the backend or its tests on the host;
   - `frontend/.env.local` for running the frontend on the host.
3. **Checks the ports**: 5432, 3001 and 3000, or the ones set in `.env`. A port already held by this project's own containers is fine.
4. **Builds and starts the stack** with `docker compose up --build -d --wait`: postgres, then migrate (migrations and demo data), then backend, then frontend. Each waits for the previous one to be healthy.
5. **Verifies** that the API reaches the database and that the web app answers.

| Option | Effect |
|---|---|
| `--install-deps` (or `make setup-dev`) | Also runs `npm ci` in `backend/` and `frontend/`, so the test suites and host development work. Needs Node.js 24. |
| `--reset` | Deletes the database volume first. All rides are removed and the demo data is re-seeded. |
| `--help` | Shows usage. |

The first run builds the images and takes a few minutes; later runs take seconds. It is safe to re-run at any time. Then open:
- **Rider app:** http://localhost:3000
- **Driver console:** http://localhost:3000/driver
- **API:** http://localhost:3001/api/v1 (readiness at `/api/v1/health/ready`)
- **API docs (Swagger UI):** http://localhost:3001/docs, with the raw OpenAPI at `/docs-json`

### 3.2 Manual setup with Docker

This is what `setup.sh` automates, without the checks:

```bash
cp .env.example .env                  # local placeholder values; never commit .env
docker compose up --build -d --wait   # or: make up
```

| Service | Role | Ready when |
|---|---|---|
| `postgres` | PostgreSQL 16. Its first start also creates `ridebooking_test` for the integration tests. | `pg_isready` passes |
| `migrate` | One-shot job: applies the SQL migrations and the idempotent demo seed, then exits | Exits with code 0 |
| `backend` | Nest.js API on port 3001 | `GET /api/v1/health/live` returns 200 |
| `frontend` | Next.js app on port 3000 | `GET /` returns 200 |

The app containers run as a non-root user, on read-only filesystems, with no Linux capabilities.

### 3.3 Local development (apps on the host)

Run the database in Docker and the backend and/or frontend with hot reload on your machine. This needs Node.js 24.

**Database**
```bash
make db        # or: docker compose up -d --wait postgres
```
This creates two databases: `ridebooking` (the app's) and `ridebooking_test` (for the integration tests).

**Backend** (http://localhost:3001)
```bash
docker compose stop backend   # free port 3001 if the Docker backend is running
cd backend
cp .env.example .env          # skip if setup.sh already created it
npm ci
npm run migrate:up            # apply SQL migrations
npm run seed                  # demo riders and drivers (idempotent)
npm run start:dev             # watch mode; http://localhost:3001/api/v1/health/ready
```

**Frontend** (http://localhost:3000)
```bash
docker compose stop frontend  # free port 3000 if the Docker frontend is running
cd frontend
cp .env.example .env.local    # skip if setup.sh already created it
npm ci
npm run dev                   # http://localhost:3000
```

The frontend needs an API to talk to: either the Docker backend or the host backend above.

### 3.4 Environment variables

Only the `.env.example` templates are committed; every value in them is a local-demo placeholder. Real `.env` files are git-ignored.

**`.env` (repository root): read by Docker Compose**

| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_USER` | `ridebooking` | Database user, created on first start |
| `POSTGRES_PASSWORD` | `change_me` | Database password. It is embedded in a `postgres://` URL, so avoid `@ : / ? #`. |
| `POSTGRES_DB` | `ridebooking` | App database; `<name>_test` is created alongside it for tests |
| `POSTGRES_HOST_PORT` | `5432` | Host port for Postgres |
| `BACKEND_HOST_PORT` | `3001` | Host port for the API. If you change it, update `NEXT_PUBLIC_API_BASE_URL` to match. |
| `LOG_LEVEL` | `info` | Backend log level |
| `CORS_ORIGINS` | `http://localhost:3000` | Browser origins allowed to call the API. Must include the frontend's URL. |
| `DRIVER_LOCATION_TTL_SECONDS` | `86400` | How long a driver's reported position stays valid. The demo default is long because seeded drivers don't stream GPS (production would use about 120). |
| `FRONTEND_HOST_PORT` | `3000` | Host port for the web app. If you change it, add the new origin to `CORS_ORIGINS`. |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001/api/v1` | API URL **as the browser sees it**. Baked into the frontend at build time, so after changing it run `docker compose up --build`. |
| `RIDE_REQUEST_TTL_SECONDS` | `300` | Optional: unaccepted requests expire after this many seconds |
| `RATE_LIMIT_LIMIT` | `120` | Optional: calls per minute per caller |
| `RATE_LIMIT_CREATE_RIDE_LIMIT` | `10` | Optional: ride requests per minute per rider |

**`backend/.env`: only when running the backend, migrations or tests on the host.** The values are validated at startup; a wrong value stops the app and names the variable.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `3001` | API port |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `DATABASE_URL` | (required) | `postgres://user:password@host:port/db` |
| `TEST_DATABASE_URL` | `…/ridebooking_test` | Used only by the integration tests. The name must end in `_test`. |
| `DB_POOL_MAX` | `10` | Connection pool size |
| `DB_LOCK_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` | `3000` / `5000` | Fail fast on stuck locks or slow queries (`503`, retryable) |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `SERVICE_AREA_BBOX` | `31.35,74.10,31.70,74.55` | Lahore service area as `minLat,minLng,maxLat,maxLng` |
| `MAX_OFFER_RADIUS_KM` | `5` | Radius for driver offers and the rider's pickup ETA |
| `DRIVER_LOCATION_TTL_SECONDS` | `120` (`86400` in the template) | Driver position freshness |
| `RIDE_REQUEST_TTL_SECONDS` | `300` | Expiry for unaccepted requests |
| `RIDE_EXPIRY_SWEEP_ENABLED` | `true` | Runs the expiry sweeper every 30 s |
| `RATE_LIMIT_TTL_SECONDS` / `RATE_LIMIT_LIMIT` / `RATE_LIMIT_CREATE_RIDE_LIMIT` | `60` / `120` / `10` | Rate-limit window, the general limit, and the ride-creation limit |

**`frontend/.env.local`: only when running the frontend on the host**

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001/api/v1` | API URL used by the browser. Public, never a secret. |

**End-to-end test overrides (optional, set in your shell):** `E2E_BASE_URL` (default `http://localhost:3000`), `E2E_API_URL` (default `http://localhost:3001/api/v1`), and `E2E_RESET_CMD`. The last replaces the data-reset command; set it to an empty string to skip the reset.

### 3.5 Everyday commands

Run `make help` for the full list.

| Make target | Plain command | Does |
|---|---|---|
| `make setup` | `./setup.sh` | Checks, `.env` files, start, verify |
| `make setup-dev` | `./setup.sh --install-deps` | The same, plus `npm ci` in both apps |
| `make up` | `docker compose up --build -d --wait` | Build and start the stack |
| `make down` | `docker compose down` | Stop the stack, keeping the data |
| `make reset` | `docker compose down -v` | Stop the stack and **delete** the database volume |
| `make logs` | `docker compose logs -f --tail=100` | Follow all container logs |
| `make db` | `docker compose up -d --wait postgres` | Start only Postgres |
| `make seed` | `docker compose exec -T backend node dist/seed/seed.js` | Re-run the idempotent demo seed |
| `make seed-reset` | `… seed.js --reset` | Delete all rides and restore the seeded drivers |
| `make test-backend` | `cd backend && npm run test && npm run test:int` | Backend unit and integration tests (starts Postgres if needed) |
| `make test-frontend` | `cd frontend && npm run test` | Frontend unit and component tests |
| `make e2e` | `cd frontend && npx playwright install chromium && npm run test:e2e` | End-to-end tests against the running stack |
| `make test` | | `test-backend` and `test-frontend` |
| `make openapi` | `npm run openapi:export`, then `npm run gen:api` | Re-export the API spec and regenerate the frontend types |

### 3.6 Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot connect to the Docker daemon` | Start Docker Desktop (Linux: `sudo systemctl start docker`) and wait until it is running. `./setup.sh` detects this. |
| `Port 5432 is already in use` (a local PostgreSQL) | Stop the local Postgres, or set `POSTGRES_HOST_PORT=5433` in `.env`. For tests on the host, also update `DATABASE_URL` and `TEST_DATABASE_URL` in `backend/.env`. |
| The browser shows "Couldn't reach the server" after changing ports | Make sure `NEXT_PUBLIC_API_BASE_URL` points at `BACKEND_HOST_PORT`, and `CORS_ORIGINS` contains `http://localhost:<FRONTEND_HOST_PORT>`. Then run `docker compose up --build`, because the API URL is baked into the frontend build. |
| "No drivers nearby" for every trip | The drivers' positions went stale, or a driver is busy. Run `make seed-reset`, or put a driver online in the driver console. |
| You want a clean slate | `./setup.sh --reset` (or `make reset && make up`) |
| A service is unhealthy | `docker compose ps`, then `docker compose logs <service>`. `./setup.sh` prints both automatically on failure. |
| Windows | Run everything inside WSL2 (Ubuntu) with Docker Desktop's WSL integration enabled. |

---

## 4. Using the app

### 4.1 Demo identities

The seed creates fixed demo users; all data is fictional. The API identifies the caller with a header, `X-Rider-Id` or `X-Driver-Id`. This is a documented stand-in for real authentication. In the UI, "Riding as" (in the header) and "Acting as driver" (in the console) switch between them.

| Rider | `X-Rider-Id` |
|---|---|
| Ayesha Khan | `11111111-1111-4111-8111-000000000001` |
| Bilal Ahmed | `11111111-1111-4111-8111-000000000002` |
| Sana Malik | `11111111-1111-4111-8111-000000000003` |

| Driver | Vehicle | Area | Seeded as | `X-Driver-Id` |
|---|---|---|---|---|
| Usman Tariq | Economy, Suzuki Alto | Gulberg | available | `22222222-2222-4222-8222-000000000001` |
| Hamza Sheikh | Economy, Suzuki Cultus | Model Town | offline | `22222222-2222-4222-8222-000000000002` |
| Ali Raza | Economy, Suzuki WagonR | Johar Town | available | `22222222-2222-4222-8222-000000000003` |
| Fatima Noor | Economy, Suzuki Alto | Walled City | available | `22222222-2222-4222-8222-000000000004` |
| Imran Qureshi | Comfort, Toyota Corolla | DHA | available | `22222222-2222-4222-8222-000000000005` |
| Zainab Hussain | Comfort, Honda Civic | Mall Road | available | `22222222-2222-4222-8222-000000000006` |

**A two-minute tour:**
1. Open http://localhost:3000 and choose Liberty Market, then Lahore Fort. You'll see Economy at Rs 767 and Comfort at Rs 1,248, each with a pickup ETA.
2. Request Economy. The page shows "Looking for a driver".
3. In a second tab, open http://localhost:3000/driver and accept the request as Usman.
4. Start the trip, then complete it. The rider tab follows each step and ends on the receipt.

### 4.2 API by example

The full reference is Swagger UI at http://localhost:3001/docs; `backend/openapi.json` is committed. This walkthrough needs `curl`, `jq` and `uuidgen`. Run `make seed-reset` first for a clean slate.

```bash
API=http://localhost:3001/api/v1
RIDER=11111111-1111-4111-8111-000000000001     # Ayesha Khan
USMAN=22222222-2222-4222-8222-000000000001     # driver: Economy, Gulberg
ZAINAB=22222222-2222-4222-8222-000000000006    # driver: Comfort, Mall Road
TRIP='"pickup":{"name":"Liberty Market","lat":31.5106,"lng":74.344},"destination":{"name":"Lahore Fort","lat":31.588,"lng":74.315}'

# 1. Fare and pickup ETA for both categories (creates nothing)
curl -s -X POST "$API/fare-estimates" -H "X-Rider-Id: $RIDER" \
  -H 'Content-Type: application/json' -d "{$TRIP}" | jq '.estimates[] | {category, total, etaMinutes}'

# 2. Request a ride. Keep the key: retries with it are safe.
KEY=$(uuidgen | tr 'A-F' 'a-f')
curl -s -i -X POST "$API/rides" -H "X-Rider-Id: $RIDER" -H "Idempotency-Key: $KEY" \
  -H 'Content-Type: application/json' -d "{$TRIP,\"category\":\"ECONOMY\"}" | grep -iE '^(HTTP|location)'

# 3. Retry with the same key: the original ride is replayed, not duplicated
curl -s -i -X POST "$API/rides" -H "X-Rider-Id: $RIDER" -H "Idempotency-Key: $KEY" \
  -H 'Content-Type: application/json' -d "{$TRIP,\"category\":\"ECONOMY\"}" | grep -iE '^(HTTP|idempotent-replayed)'
RIDE=$(curl -s "$API/riders/me/active-ride" -H "X-Rider-Id: $RIDER" | jq -r .ride.id)

# 4. Two drivers race to accept: exactly one 200, the other 409 RIDE_ALREADY_ASSIGNED
for D in $USMAN $ZAINAB; do
  curl -s -o /dev/null -w "driver $D -> %{http_code}\n" -X POST "$API/rides/$RIDE/accept" -H "X-Driver-Id: $D" &
done; wait

# 5. The winner starts and completes the trip
WINNER=$(curl -s "$API/rides/$RIDE" -H "X-Rider-Id: $RIDER" | jq -r .driver.id)
curl -s -X POST "$API/rides/$RIDE/start" -H "X-Driver-Id: $WINNER" | jq -r .status
curl -s -X POST "$API/rides/$RIDE/complete" -H "X-Driver-Id: $WINNER" | jq '{status, fare: .fare.finalTotal}'

# 6. An illegal transition is rejected: a completed ride cannot be cancelled
curl -s -X POST "$API/rides/$RIDE/cancel" -H "X-Rider-Id: $RIDER" \
  -H 'Content-Type: application/json' -d '{}' | jq .error
```

What you should see:
1. Economy Rs 767 and Comfort Rs 1,248, each with a pickup ETA.
2. `201 Created` with a `Location` header.
3. `200 OK` with `Idempotent-Replayed: true`.
4. One driver gets `200` and the other `409`; which one wins varies.
5. `IN_PROGRESS`, then `COMPLETED` with fare 767.
6. A `409 INVALID_STATE_TRANSITION` error envelope with a `requestId`.

| Method | Path (under `/api/v1`) | Caller | Purpose |
|---|---|---|---|
| POST | `/fare-estimates` | rider | Fare and ETA for both categories |
| POST | `/rides` | rider | Request a ride (`Idempotency-Key` required) |
| GET | `/rides/{id}` | rider or driver | Ride details (supports `If-None-Match` / `304`) |
| POST | `/rides/{id}/accept` | driver | Accept a requested ride |
| POST | `/rides/{id}/start` | assigned driver | Start the trip |
| POST | `/rides/{id}/complete` | assigned driver | Complete the trip |
| POST | `/rides/{id}/cancel` | rider or assigned driver | Cancel before the trip starts |
| GET | `/riders/me/active-ride` | rider | The rider's current ride, or `null` |
| GET | `/drivers/{id}` | that driver | Profile, availability and active ride |
| PATCH | `/drivers/{id}/availability` | that driver | Go online or offline, report a position |
| GET | `/drivers/{id}/offers` | that driver | Nearby requests the driver can accept |
| GET | `/health/live`, `/health/ready` | anyone | Liveness, and readiness including the database |

Every error has the same shape: `{ "error": { "code", "message", "details?", "requestId" } }`. Which module rejects what, and why, is mapped endpoint by endpoint in [docs/SYSTEM_GUIDE.md](docs/SYSTEM_GUIDE.md#5-red-paths-at-a-glance).

---

## 5. NPM scripts reference

Run these inside `backend/` or `frontend/`. They need Node.js 24 and `npm ci` (or `./setup.sh --install-deps`).

### Backend (`backend/package.json`)

| Command | Runs | Use it to |
|---|---|---|
| `npm run build` | `nest build` | Compile TypeScript to `dist/` |
| `npm start` | `nest start --env-file .env` | Run the API once with `backend/.env` |
| `npm run start:dev` | `nest start --watch --env-file .env` | Develop with automatic restarts |
| `npm run start:debug` | `nest start --debug --watch --env-file .env` | The same, with the Node inspector attached |
| `npm run start:prod` | `node dist/main.js` | Run the compiled build (what the container runs) |
| `npm run lint` | `oxlint --type-aware --deny-warnings .` | Lint, with type-aware rules; any warning fails |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json` | Type-check without emitting |
| `npm run format` / `format:check` | `prettier --write` / `--check` | Format the code, or verify formatting (CI) |
| `npm test` | `vitest run` | **Unit tests** (453): pure logic, no database |
| `npm run test:watch` | `vitest` | Unit tests in watch mode |
| `npm run test:cov` | `vitest run --coverage` | Unit tests with a coverage report in `coverage/` |
| `npm run test:int` | `vitest run --config ./vitest.config.int.ts` | **Integration tests** (107): the real app against real PostgreSQL (`TEST_DATABASE_URL`), including the concurrency races. Runs files one at a time. |
| `npm run test:int:cov` | the same, with `--coverage` | Integration tests with coverage |
| `npm run migrate:up` / `migrate:down` | `tsx src/scripts/migrate.ts up` / `down` | Apply or roll back the SQL migrations on `DATABASE_URL` |
| `npm run migrate:create -- <name>` | `node-pg-migrate create --migration-file-language sql` | Create a new SQL migration file |
| `npm run seed` | `tsx src/seed/seed.ts` | Insert demo riders and drivers (idempotent) |
| `npm run seed:reset` | `tsx src/seed/seed.ts --reset` | Delete all rides and restore the seeded drivers |
| `npm run openapi:export` | `nest build && node dist/scripts/export-openapi.js` | Regenerate `backend/openapi.json`. No database needed. |

### Frontend (`frontend/package.json`)

| Command | Runs | Use it to |
|---|---|---|
| `npm run dev` | `next dev --port 3000` | Develop with hot reload |
| `npm run build` | `next build` | Production build (standalone output for Docker) |
| `npm start` | `next start --port 3000` | Serve the production build locally. Next notes that a standalone build is normally run with `node .next/standalone/server.js`, which is what the Docker image does. |
| `npm run lint` | `eslint --max-warnings 0 .` | Lint (Next.js, React hooks and TypeScript rules); any warning fails |
| `npm run typecheck` | `next typegen && tsc --noEmit` | Generate Next's route types, then type-check, including the tests |
| `npm run format` / `format:check` | `prettier --write .` / `--check .` | Format, or verify formatting |
| `npm test` | `vitest run` | **Unit and component tests** (131), with the API mocked at the network level (MSW) |
| `npm run test:watch` | `vitest` | The same, in watch mode |
| `npm run test:cov` | `vitest run --coverage` | The same, with coverage |
| `npm run test:e2e` | `playwright test` | **End-to-end tests** (5) against the running stack; run `npx playwright install chromium` once first (or use `make e2e`) |
| `npm run gen:api` | `openapi-typescript ../backend/openapi.json --output src/types/api.gen.ts` | Regenerate the frontend's API types from the backend contract |

---

## 6. Testing and reliability

Every test suite runs against real code paths. The integration tests use a real PostgreSQL, because row locks and unique indexes *are* the behaviour under test. The end-to-end tests drive real browsers against the real Docker images.

| Suite | Tool | Tests | Location | Run with |
|---|---|---|---|---|
| Backend unit | Vitest | 453 | `backend/src/**/*.spec.ts` | `cd backend && npm test` |
| Backend integration | Vitest + Supertest + PostgreSQL 16 | 107 | `backend/test/*.int-spec.ts` | `make test-backend` (starts Postgres) |
| Frontend unit and component | Vitest + React Testing Library + MSW | 131 | `frontend/tests/unit/` | `make test-frontend` |
| End-to-end | Playwright (Chromium) | 5 | `frontend/tests/e2e/` | `make up && make e2e` |

### Concurrency
- **10 drivers accept the same ride at once, repeated 20 times.** There is always exactly one `200` and nine `409 RIDE_ALREADY_ASSIGNED`. After every run the database is checked: one active assignment, the winner `BUSY`, the losers still `AVAILABLE` (`concurrency.int-spec.ts`).
- **One driver accepts two rides at once**, ×20: they end up with exactly one.
- **Accept races cancel, and start races cancel**, ×20, with both orders observed. Two further tests force each interleaving exactly: they hold the row lock and confirm through `pg_stat_activity` that the requests are queued behind it.
- **Defence in depth is proven.** Removing the row lock, then the compare-and-swap, still leaves one winner; removing every layer makes the tests fail.
- **Through the UI:** an end-to-end test has two browser contexts press Accept at the same moment. Exactly one sees "Ride accepted" and the other sees "Another driver took this ride".
- **Database constraints are checked directly with raw SQL** (`database-constraints.int-spec.ts`). Lock timeouts and an unreachable database become retryable `503`s (`errors.int-spec.ts`).

### Ride booking and idempotency
- **Successful creation:**
  - `201`, `REQUESTED`;
  - the stored fare equals the quote the rider was shown;
  - the `Location` header points at the ride (`create-ride.int-spec.ts`).
- **Invalid input is rejected with `400` and field errors, and nothing is saved:**
  - missing fields, bad UUIDs, coordinates out of range;
  - outside Lahore, a trip under 200 m, a bad category, unknown fields;
  - a missing `Idempotency-Key`.
- **Duplicates** (`idempotency.int-spec.ts`):
  - the same key and body is replayed byte-identically;
  - **10 identical requests in parallel create exactly one ride**;
  - the same key with a different body gets `422`;
  - a second active ride gets `409 ACTIVE_RIDE_EXISTS`.
- **Client side** (`request-ride.test.tsx`):
  - a double click sends one request;
  - Retry after a network error or 5xx sends the **same** key;
  - a changed trip gets a new key;
  - `409`, `400` and `429` are each handled.

  These were checked by breaking the double-submit guard and the key reuse on purpose: the tests failed.
- **End to end:**
  - the full booking-to-receipt flow;
  - the cancel flow;
  - a forced 500 followed by Retry, which creates exactly one ride;
  - a ride committed whose response was lost, where the retry is a *replay* (`Idempotent-Replayed: true`).

### State transitions
- **Unit:** all 144 combinations of from-status, to-status and caller are checked against an independent specification of the rules (`ride-state-machine.spec.ts`).
- **Integration** (`transitions.int-spec.ts`): 18 illegal transitions, such as completing a requested ride, cancelling a trip in progress, accepting a cancelled ride, or a driver who isn't assigned starting the trip. Each must return the right `409` or `403`, and the ride, drivers, assignments and fare must be **identical before and after**.
- **The full lifecycle** (`lifecycle.int-spec.ts`): create, accept, start, complete. The driver is freed and the final fare is set. Cancels by the rider and by the driver are covered, and so are idempotent repeats.
- **Expiry** (`expiry.int-spec.ts`): only stale `REQUESTED` rides expire; an accept racing the sweeper never loses its ride; an accept after expiry gets `409`.
- **Frontend** (`ride-view.test.tsx`):
  - every status renders correctly, and Cancel appears only where it is allowed;
  - polling stops on terminal states and pauses in hidden tabs;
  - "Reconnecting…" keeps the last status during an outage;
  - a `409` on cancel is explained and then refetched.

### Rate limits
- **Integration** (`throttle.int-spec.ts`): the 11th ride request in a minute gets `429 RATE_LIMITED` with `Retry-After`, while another rider is unaffected.
- **Unit** (`rate-limit.module.spec.ts`): the per-caller bucket key, which is the identity header if it is a valid UUID, otherwise the IP.
- **Frontend** (`request-ride.test.tsx`): a `429` turns into a countdown from `Retry-After` and disables Request.

### Errors, auth and contract
- **Error format:** every error response conforms to the one envelope schema with a `requestId`, and a forced 500 leaks no stack trace (`errors.int-spec.ts`).
- **Authorization:** other riders get `404` on someone else's ride, wrong roles get `403`, and drivers can only act on their own profile (`authorization.int-spec.ts`).
- **API contract:** `openapi.json` must match the running app (`health-openapi.int-spec.ts`). The frontend's demo users and landmark coverage are checked against the backend seed (`demo-data.test.ts`).

### How we know the tests catch real bugs
Key behaviours were broken on purpose, one at a time, and the suites had to fail. Examples:
- cancel allowed while a trip is in progress;
- the category rule inverted;
- the minimum fare dropped;
- the row lock and compare-and-swap removed;
- the double-submit guard removed;
- a new key sent on every retry;
- polling left running after completion.

Each time, the relevant tests failed; the source was then restored from git. The full log is in [docs/AI_DISCLOSURE.md](docs/AI_DISCLOSURE.md).

---

## 7. Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:
- **backend:** lint, typecheck, format check, unit tests, integration tests against a Postgres 16 service, a check that `openapi.json` matches the code, and an audit of production dependencies;
- **frontend:** lint, typecheck, format check, unit and component tests, a check that the generated API types match `openapi.json`, the production build, and an audit of production dependencies;
- **e2e:** starts the stack with `cp .env.example .env && docker compose up --build -d --wait`, then runs Playwright. On failure it uploads the report and prints container logs.

## 8. Repository layout
```
setup.sh                  one-command local setup (pre-flight checks, .env files, start, verify)
backend/                  Nest.js API (modular monolith, raw SQL repositories)
  migrations/             SQL migrations (node-pg-migrate)
  src/                    modules: rides, drivers, riders, fares, matching, idempotency, health, common
  test/                   integration tests against real PostgreSQL
  openapi.json            exported API contract (committed)
frontend/                 Next.js rider app and driver console
  src/                    app routes, components, hooks, lib (API client, state logic)
  tests/unit/             Vitest unit and component tests (MSW)
  tests/e2e/              Playwright end-to-end tests
docker/                   Postgres init script (creates the _test database)
docs/                     architecture, system guide, decisions, AI disclosure, blueprint
.github/workflows/ci.yml  CI pipeline
docker-compose.yml        local stack: postgres, migrate, backend, frontend
Makefile                  shortcuts for common tasks (make help)
```

## 9. Documentation
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design, diagrams, the eight architecture answers, assumptions and known limitations
- [docs/SYSTEM_GUIDE.md](docs/SYSTEM_GUIDE.md): glossary, the module breakdown, and request flows with green and red paths per endpoint
- [docs/DECISIONS.md](docs/DECISIONS.md): where and why the build departs from the blueprint
- [docs/AI_DISCLOSURE.md](docs/AI_DISCLOSURE.md): AI tools used and how their output was verified
- [docs/blueprint.md](docs/blueprint.md): the engineering blueprint this build follows
