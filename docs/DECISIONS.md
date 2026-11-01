# Decisions and deviations from the blueprint

`docs/blueprint.md` (Step 5) is the build spec. This file records every place the implementation refines or departs from it, and why. Each entry is meant to be explainable in an interview in one or two sentences.

## D1. Migrations run in a separate one-shot `migrate` service
- **Blueprint:** the backend container runs `migrate:up` and then `start:prod`.
- **Decision:** a one-shot `migrate` compose service, built from the same backend image, runs `migrate:up` followed by the idempotent seed. `backend` starts only after it exits successfully (`depends_on: service_completed_successfully`).
- **Why:** this matches how migrations run in production (as a pre-deploy step, see ARCHITECTURE Q7). It also means replicas never race on migrations, and the runtime command stays `node dist/main.js`, so the process receives SIGTERM directly.

## D2. Fixed seed UUIDs shared by every consumer
- **Blueprint:** the frontend reads seeded IDs from env.
- **Decision:** seed riders and drivers have fixed, v4-shaped UUIDs (`backend/src/seed/seed-data.ts`). The README curl examples, integration fixtures, E2E tests and the frontend's `lib/demo-actors.ts` all use them.
- **Why:** reproducible demos and tests with no env plumbing. The frontend copy is a small, documented duplicate, acceptable for demo-only identities.

## D3. `GET /drivers/{id}` added (self only)
- **Decision:** returns the driver's availability, location and current `activeRide`. The path id must match `X-Driver-Id`.
- **Why:** after a refresh, the driver console needs to know whether it is mid-trip, the same way the rider page uses `/riders/me/active-ride`.

## D4. Driver location freshness is configurable, with a long demo default
- **Decision:** `DRIVER_LOCATION_TTL_SECONDS` defaults to 120 in code. `.env.example` sets 86400.
- **Why:** seeded drivers don't stream GPS. With a 2-minute window, a fresh `docker compose up` would show "No drivers nearby" after two minutes. Production would use ~60–120 s with real location pings.

## D5. Database timeouts and extra error codes
- **Decision:** the pool sets `lock_timeout` (3 s) and `statement_timeout` (5 s). Postgres `55P03` (lock not available) and `57014` (statement timeout) map to `503 SERVICE_UNAVAILABLE` with `Retry-After`. A `23505` unique violation the service did not anticipate maps to a generic `409 CONFLICT`.
- **Why:** a stuck lock should fail fast and visibly instead of exhausting the pool. The added codes extend the blueprint's error table without changing existing ones.

## D6. Exactly one actor header on dual-actor endpoints
- **Decision:** `GET /rides/{id}` and `POST /rides/{id}/cancel` accept `X-Rider-Id` or `X-Driver-Id`, but not both (400).
- **Why:** an ambiguous identity must never be guessed at. Picking one header silently would let an authorization decision depend on header order.

## D7. `GET /riders/me/active-ride` returns `200 { ride: Ride | null }`
- **Why:** having no active ride is a normal state, not an error, so it should not produce error responses or logs.

## D8. Frontend API types are generated from OpenAPI
- **Decision:** `backend/openapi.json` (exported by `npm run openapi:export`) is converted with `openapi-typescript` into `frontend/src/types/api.gen.ts`, which is committed. CI regenerates both and fails on any diff.
- **Why:** one source of truth for the contract, without introducing a shared workspace package.

## D9. One `configureApp(app)` shared by runtime, tests and the OpenAPI export
- **Why:** integration tests then exercise the exact same global pipes, filters, prefix, CORS and security headers as production. The OpenAPI document cannot drift from the running app.

## D10. Integration tests use a dedicated `<db>_test` database, run in band
- **Decision:** the compose Postgres init script creates `ridebooking_test`. Integration tests run serially (no file parallelism) and truncate tables between tests.
- **Why:** tests run against real Postgres (row locks and partial unique indexes are the thing under test) without touching demo data. Running serially avoids cross-file `TRUNCATE` races.

## D11. Throttle limits come from env
- **Decision:** the global limit and the stricter `POST /rides` limit are env-configured. They are set high in tests, and a dedicated test asserts the `429 RATE_LIMITED` envelope with a low limit.
- **Why:** the "10 parallel identical requests" idempotency test would otherwise be rejected by the 10/min limit instead of testing idempotency.

## D12. ETag polling via Express defaults
- **Decision:** `GET /rides/{id}` relies on Express's weak ETag and sets `Cache-Control: no-cache`, so the browser revalidates and gets `304` when nothing changed. CORS exposes `ETag`, `X-Request-Id`, `Idempotent-Replayed` and `Retry-After`.
- **Why:** cheap polling with no custom caching code.

## D13. Backend uses Nest 12's default toolchain: Vitest, oxlint, native ESM
- **Blueprint:** Jest + Supertest for backend tests, ESLint + Prettier for linting.
- **Decision:** keep what `@nestjs/cli@12 new` generates: Vitest + Supertest, oxlint (type-aware) + Prettier, and `"type": "module"` with `nodenext` resolution. TypeScript stays on the version the CLI pins (6.0).
- **Why:** the blueprint picked Jest and ESLint because they were Nest's defaults when it was written; the intent was "latest Nest". Fighting the scaffold (Jest under ESM needs experimental flags) would cost time and add fragility. Vitest also matches the frontend, so the whole repo uses one test runner and one assertion API. Verified before adopting: Vitest emits decorator metadata, so Nest DI works in tests. oxlint enforces `no-explicit-any`, `eqeqeq`, `no-floating-promises` and `no-misused-promises` as errors.
- **Consequences:** relative imports carry a `.js` extension; `import.meta.dirname` replaces `__dirname`.

## D14. Migrations run through node-pg-migrate's programmatic runner
- **Decision:** `src/database/migrations.ts` wraps node-pg-migrate's `runner()` (SQL files with `-- Up Migration` / `-- Down Migration` sections). The same function serves `npm run migrate:up|down` (via `tsx` on the host), `node dist/scripts/migrate.js` in the Docker `migrate` service, and the integration-test setup.
- **Why:** one code path for every environment. It reuses the validated `DATABASE_URL`, and it takes node-pg-migrate's advisory lock, so two runners can never apply the same migration concurrently.

## Kept exactly as the blueprint specifies
- An idempotent replay of `POST /rides` returns `200` with `Idempotent-Replayed: true`, not the original `201`.
- Lock order is always ride → driver.
- `POST /rides/{id}/start` exists because `complete` requires `IN_PROGRESS`.
- A driver cancelling an `ASSIGNED` ride moves it to `CANCELLED`, not back into the queue (listed as a known limitation).

## Repository hygiene
- `docs/assessment.pdf` (the employer's brief) is git-ignored and is not part of the submission. Remove the line from `.gitignore` if it should be included.
