# Ride booking (Lahore)

A simplified ride-hailing app. A rider picks pickup and destination, chooses Economy or Comfort, sees an estimated fare and pickup ETA, requests a ride, and follows its status. Drivers accept, start and complete rides. The backend guarantees that one ride gets exactly one driver, and that retries never create duplicate rides.

**Stack:** Next.js (App Router, TypeScript) · Nest.js (TypeScript) · PostgreSQL 16 · Docker Compose

How it works and why: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), which also answers the assessment's eight architecture questions.

## Prerequisites
- Docker Desktop (or Docker Engine) with Compose v2
- Node.js 24 (see `.nvmrc`), only needed to run the apps or tests outside Docker
- `make` (optional; every target is a thin wrapper around commands listed in the `Makefile`)

## Quick start
```bash
cp .env.example .env              # local placeholder values only
docker compose up --build -d --wait   # or: make up
```

This starts four services in order:
1. **postgres**, which waits until healthy;
2. **migrate**, a one-shot job that applies migrations and the idempotent seed, then exits;
3. **backend**, which waits until healthy;
4. **frontend**, which waits until healthy.

The first build takes a few minutes; later starts take well under a minute.

Then open:
- **Rider app:** http://localhost:3000. Pick two landmarks, compare Economy and Comfort, and request a ride. "Riding as" in the header switches between the three seeded riders.
- **Driver console (simulation):** http://localhost:3000/driver. Go online, accept the ride, start it and complete it, and watch the rider tab follow along. Open it in two tabs to race two drivers for the same ride.
- API: http://localhost:3001/api/v1 (readiness: `/api/v1/health/ready`)
- API docs (Swagger UI): http://localhost:3001/docs, raw OpenAPI at `/docs-json`

Ports and URLs come from `.env`. `NEXT_PUBLIC_API_BASE_URL` is baked into the frontend at build time, so after changing it run `docker compose up --build`. If you change `FRONTEND_HOST_PORT`, add the new origin to `CORS_ORIGINS`.

Useful commands: `make logs`, `make seed-reset` (deletes all rides and restores the seeded drivers), `make down` (keeps data), `make reset` (also deletes the database volume).

## Demo identities
The seed creates fixed demo users; all data is fictional. The API identifies the caller by a header (`X-Rider-Id` or `X-Driver-Id`), a documented stand-in for real authentication.

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

## API by example
The full reference is Swagger UI at http://localhost:3001/docs, and `backend/openapi.json` is committed. The walkthrough below runs against the Docker stack and needs `curl`, `jq` and `uuidgen`; run `make seed-reset` first for a clean slate.

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

Every error response has the same shape: `{ "error": { "code", "message", "details?", "requestId" } }`.

### Backend on the host (development)
```bash
cd backend
cp .env.example .env        # points at the compose Postgres on localhost:5432
npm install
npm run migrate:up          # apply SQL migrations
npm run seed                # idempotent demo riders/drivers (npm run seed:reset wipes rides)
npm run start:dev           # http://localhost:3001/api/v1/health/ready
npm test                    # unit tests (no database)
npm run test:int            # integration tests against ridebooking_test (compose Postgres)
npm run lint && npm run typecheck
```

`make test-backend` starts Postgres if needed and runs both suites. The integration tests:
- use the real app against real PostgreSQL;
- refuse to run unless the database name ends in `_test`;
- include concurrency races, e.g. 10 drivers accepting the same ride, repeated 20 times.

### Frontend on the host (development)
Needs the API running, either the compose `backend` or the host backend above.
```bash
cd frontend
cp .env.example .env.local  # NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
npm install
npm run dev                 # http://localhost:3000 (stop the compose frontend first: port 3000)
npm test                    # unit + component tests (Vitest, React Testing Library, MSW); no server needed
npm run lint && npm run typecheck
npm run gen:api             # regenerate src/types/api.gen.ts after backend/openapi.json changes
```

`make test-frontend` runs the same tests. The component tests mock the API with MSW at the network level, so they exercise the real fetch client. They cover:
- loading, empty and error states;
- that a retried ride request reuses the same `Idempotency-Key`;
- that ride polling stops on terminal states and pauses in hidden tabs;
- the "Reconnecting…" banner and conflict handling on cancel.

### End-to-end tests (Playwright)
These run real browsers against the running Docker stack, the same images a reviewer starts.
```bash
make up     # the full stack must be running
make e2e    # installs Chromium if needed, resets the demo data, runs the suite (~25 s)
# without make: cd frontend && npx playwright install chromium && npm run test:e2e
```

| Test | What it proves |
|---|---|
| 21, main flow | A rider books Liberty Market → Lahore Fort. A driver in a second browser goes online, accepts, starts and completes. The rider page follows every status to a receipt equal to the quoted fare. |
| 22, cancel flow | The rider cancels after confirming, and the ride disappears from the driver console. |
| 23, error and retry | The first `POST /rides` fails with a 500. Retry sends the same `Idempotency-Key` and exactly one ride exists. |
| 23b, lost response | The API commits the ride but the browser never receives the answer. Retry gets a `200` replay (`Idempotent-Replayed: true`) of the same ride, not a second booking. |
| Driver race | Two driver browsers press Accept at the same moment. One gets the ride; the other sees "Another driver took this ride." |

- **On failure:** the HTML report, with traces and screenshots, is in `frontend/playwright-report`.
- **Another deployment:** set `E2E_BASE_URL` and `E2E_API_URL`.
- **Resetting data:** the suite resets with `docker compose exec -T backend node dist/seed/seed.js --reset`. Set `E2E_RESET_CMD` to replace that command, or to an empty string to skip it. The tests clean up after themselves, so they also pass without a reset, in any order.

## Continuous integration
`.github/workflows/ci.yml` runs on every push to `main` and every pull request:
- **backend:** lint, typecheck, format check, unit tests, integration tests against a Postgres 16 service, a check that `openapi.json` matches the code, and an audit of production dependencies;
- **frontend:** lint, typecheck, format check, unit and component tests, a check that the generated API types match `openapi.json`, the production build, and an audit of production dependencies;
- **e2e:** starts the stack with `cp .env.example .env && docker compose up --build -d --wait`, then runs Playwright. On failure it uploads the report and prints container logs.

## Repository layout
```
backend/                  Nest.js API (modular monolith, raw SQL repositories)
  migrations/             SQL migrations (node-pg-migrate)
  src/                    modules: rides, drivers, riders, fares, matching, idempotency, health
  test/                   integration tests against real PostgreSQL
  openapi.json            exported API contract (committed)
frontend/                 Next.js rider app and driver console
  src/                    app routes, components, hooks, lib (API client, state logic)
  tests/unit/             Vitest unit and component tests (MSW)
  tests/e2e/              Playwright end-to-end tests
docker/                   Postgres init script (creates the _test database)
docs/                     architecture, decisions, AI disclosure, blueprint
.github/workflows/ci.yml  CI pipeline
docker-compose.yml        local stack: postgres, migrate, backend, frontend
Makefile                  shortcuts for common tasks (`make help`)
```

## Documentation
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design, diagrams, the eight architecture answers, assumptions and known limitations
- [docs/DECISIONS.md](docs/DECISIONS.md): where and why the build departs from the blueprint
- [docs/AI_DISCLOSURE.md](docs/AI_DISCLOSURE.md): AI tools used and how their output was verified
- [docs/blueprint.md](docs/blueprint.md): the engineering blueprint this build follows
