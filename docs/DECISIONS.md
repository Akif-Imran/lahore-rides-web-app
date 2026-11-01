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
- **Decision:** the pool sets `lock_timeout` (3 s) and `statement_timeout` (5 s). These Postgres errors all map to `503 SERVICE_UNAVAILABLE` with `Retry-After: 1` and `details.retryable: true`:
  - `55P03` (lock not available) and `57014` (statement timeout);
  - `40001` (serialization failure) and `40P01` (deadlock), which explicit lock ordering should prevent anyway;
  - connection failures.
  A `23505` unique violation the service did not anticipate maps to a generic `409 CONFLICT`. Constraint names never reach the client.
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

## D15. Lifecycle rules: error precedence, idempotency and visibility details
The blueprint fixes the transition table and the error codes. These rules fill in what it leaves open. All are pure functions in `rides/ride-state-machine.ts`, `rides/ride-access.ts` and `matching/eligibility.ts`, with table-driven tests.
- **State before permission.** An impossible transition is `409 INVALID_STATE_TRANSITION` for everyone, for example completing a `REQUESTED` ride. A legal transition attempted by the wrong party is `403 FORBIDDEN`, for example a driver who is not assigned starting the trip. This is the split blueprint test 11 expects.
- **Permanent before transient.** On accept, a vehicle-category mismatch (`403 DRIVER_NOT_ELIGIBLE`) is reported before availability or a stale location (`409 DRIVER_UNAVAILABLE`). Retrying can never fix the former.
- **`start` is idempotent for the assigned driver**, like accept, cancel and complete (blueprint 3.3D lists only those three). A retried "Start trip" returns 200 with the current ride.
- **Who may view a ride:** its rider, its assigned driver (also after a cancel), and any driver who could accept it right now (`REQUESTED` and category-compatible). The offer radius is not applied to direct reads, only to the offers list.
- **Non-owner riders get 404, not 403**, so other riders cannot probe which ride ids exist (blueprint 4.3).
- **Error code for a too-short trip:** `TRIP_TOO_SHORT`, inside a `VALIDATION_ERROR` field error. The pickup and destination are not necessarily identical, only closer than 200 m.

## D16. Swagger schemas are written by hand, not generated by the Nest CLI plugin
- **Decision:** every DTO property carries an explicit `@ApiProperty`. Each response DTO class `implements` the mapper's interface (e.g. `RideResponseDto implements RideResponse`).
- **Why:** Vitest does not run Nest CLI plugins, so plugin-generated metadata would make the OpenAPI document in tests differ from the built app's. With `implements`, the documented shape cannot drift from the real response without a compile error.

## D17. Seed driver positions are chosen for coverage, and one radius bounds ETA and offers
- **Decision:** the pickup ETA and a driver's offer list both use `MAX_OFFER_RADIUS_KM` (5 km). Seeded drivers sit in Gulberg, Johar Town, the Walled City, DHA and Mall Road, so every one of the 12 frontend landmarks has an Economy driver within 5 km. Hamza (Model Town) is the one seeded `OFFLINE` driver.
- **Why:** if the ETA radius were wider than the offer radius, a rider could be shown an ETA from a driver who would never see the ride, and the request would silently expire. The blueprint's original seed left the Walled City, Railway Station and Mall Road without Economy cover, so even a ride from Lahore Fort would show "No drivers nearby". With only two Comfort cars, Comfort still has gaps on the outskirts. That is realistic, and it exercises the UI's empty state.

## D18. Repositories are registered once, in a global `RepositoriesModule`
- **Why:** repositories are stateless SQL adapters shared across features (matching reads drivers and rides, the identity guard reads riders and drivers). Registering them centrally keeps the feature-module graph acyclic, with no `forwardRef`. SQL still lives only in the repository files.

## D19. API shape details the blueprint leaves open
- **Fare and trip fields:** the final fare is `fare.finalTotal` (null until completed) rather than a top-level `finalFare`. Rides also return `distanceMeters` and `durationSeconds`.
- **Driver object:** `driver` is `{ id, name, vehicle, plate, vehicleCategory, location }`. **`location` is only shown while the ride is `ASSIGNED` or `IN_PROGRESS`**, so a rider cannot keep tracking a driver after the trip ends.
- **Location header:** `201 Created` responses include `Location: /api/v1/rides/{id}`.
- **No nearby driver:** the API still accepts `POST /rides`. The UI blocks the request (blueprint 5.4.2), and an accepted ride with no taker expires after `RIDE_REQUEST_TTL_SECONDS`.
- **Availability while BUSY:** `PATCH /drivers/{id}/availability` on a busy driver is `409 CONFLICT`. Only the ride lifecycle sets or clears `BUSY`.
- **Fare estimates require `X-Rider-Id`,** so they are rate-limited per rider like every other call.

## D20. Rate limiting is per caller, with two limits
- **Decision:** a global limit (`RATE_LIMIT_LIMIT` per `RATE_LIMIT_TTL_SECONDS`) plus a stricter `POST /rides` limit (`RATE_LIMIT_CREATE_RIDE_LIMIT`), both from env. The bucket is the caller's identity header when it is a valid UUID, otherwise the client IP. The 429 response carries a standard `Retry-After`; the filter normalises the throttler's `Retry-After-<name>` header.
- **Why:** keying on identity stops one shared IP (NAT, or a demo with several tabs) from throttling everyone behind it. **Limitation:** with header-based demo identities the key is spoofable. With real authentication it becomes the authenticated user id.

## D21. Expiry sweeper
- **Decision:** `RideExpiryScheduler` runs every 30 s when `RIDE_EXPIRY_SWEEP_ENABLED`, registered through `@nestjs/schedule`'s `SchedulerRegistry` so it is cleared on shutdown. Integration tests disable it and call `sweep()` directly.
- **Why:** the work is a single conditional `UPDATE … WHERE status = 'REQUESTED' AND requested_at < now() - ttl`, which is safe on every replica at once. An accept holding the row lock makes the sweep wait and re-check, so a just-assigned ride is never expired.

## D22. Blueprint test 10 (accept vs cancel race): adjusted expectation, plus forced interleavings
- **Blueprint:** "parallel accept and cancel: either ASSIGNED with the cancel rejected, or CANCELLED with the accept rejected, never both."
- **Why it was adjusted:** the blueprint's own state machine (3.2) lets the rider cancel an `ASSIGNED` ride. If the accept commits first, the cancel then legitimately succeeds as well. So "accept 200, then cancel 200, final `CANCELLED`, driver freed" is a correct outcome, not a bug.
- **What the tests check instead** (`test/concurrency.int-spec.ts`):
  - **Random race:** both requests are sent at once, 20 times, alternating which goes first, and both orders do occur. After each run the database must be fully consistent: no `BUSY` driver without an active assignment, no active assignment on a cancelled ride, and so on (`assertInvariants`).
  - **Forced interleavings:** the test holds the ride's row lock, queues the two requests behind it in a chosen order (checked through `pg_stat_activity`), then releases it. One test runs accept-then-cancel and the other cancel-then-accept, each with exact expected results.
  - **Start vs cancel:** the race where "never both" genuinely holds, because cancelling is illegal once a trip has started.

## Kept exactly as the blueprint specifies
- An idempotent replay of `POST /rides` returns `200` with `Idempotent-Replayed: true`, not the original `201`.
- Lock order is always ride → driver.
- `POST /rides/{id}/start` exists because `complete` requires `IN_PROGRESS`.
- A driver cancelling an `ASSIGNED` ride moves it to `CANCELLED`, not back into the queue (listed as a known limitation).

## Repository hygiene
- `docs/assessment.pdf` (the employer's brief) is git-ignored and is not part of the submission. Remove the line from `.gitignore` if it should be included.
