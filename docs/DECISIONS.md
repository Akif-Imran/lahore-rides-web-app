# Decisions and deviations from the blueprint

`docs/blueprint.md` (Step 5) is the build spec. This file records every place the implementation refines or departs from it, and why. Each entry is meant to be explainable in an interview in one or two sentences.

## D1. Migrations run in a separate one-shot `migrate` service
- **Blueprint:** the backend container runs `migrate:up` and then `start:prod`.
- **Decision:** a one-shot `migrate` compose service, built from the same backend image, runs `migrate:up` followed by the idempotent seed. `backend` starts only after it exits successfully (`depends_on: service_completed_successfully`).
- **Why:** this matches how migrations run in production (as a pre-deploy step, see ARCHITECTURE Q7). It also means replicas never race on migrations, and the runtime command stays `node dist/main.js`, so the process receives SIGTERM directly.

## D2. Fixed seed UUIDs shared by every consumer
- **Blueprint:** the frontend reads seeded IDs from env.
- **Decision:** seed riders and drivers have fixed, v4-shaped UUIDs (`backend/src/seed/seed-data.ts`). The README curl examples, integration fixtures, E2E tests and the frontend's `lib/demo-actors.ts` all use them.
- **Why:** reproducible demos and tests with no env plumbing. The frontend copy is a small, documented duplicate, acceptable for demo-only identities. A frontend unit test (`tests/unit/demo-data.test.ts`) imports the backend seed file and fails if the two copies diverge.

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

## D12. ETag polling: Express ETags on the server, an explicit cache in the client
- **Backend:** `GET /rides/{id}` relies on Express's weak ETag and sets `Cache-Control: no-cache`. CORS allows `If-None-Match` and exposes `ETag`, `X-Request-Id`, `Idempotent-Replayed` and `Retry-After`.
- **Frontend (refined in Phase 6):** the API client keeps the last ETag and body per caller and URL (`EtagCache` in `lib/api-client.ts`). It sends `If-None-Match` itself and reuses the cached body on `304`. Every request uses `fetch(..., { cache: 'no-store' })`, so the browser's own HTTP cache is never involved.
- **Why:** the browser cache is keyed on the URL, but the same URL answers differently for different `X-Rider-Id`/`X-Driver-Id` headers. A small cache keyed by caller is easier to reason about, and a unit test checks both the header and the 304 reuse. Polling stays cheap: an unchanged ride costs a 304 with no body, and the UI does not re-render.

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
- **Decision:** the pickup ETA and a driver's offer list both use `MAX_OFFER_RADIUS_KM` (5 km, measured as straight-line Haversine distance). Seeded drivers sit in Gulberg, Johar Town, the Walled City, DHA and Mall Road. As a result, every one of the 12 frontend landmarks has an *available driver who can take an Economy ride* within 5 km: either an Economy car, or a Comfort car, since Comfort cars may take Economy rides. Hamza (Model Town) is the one seeded `OFFLINE` driver.
- **Correction (Phase 6):** this entry first said "an Economy driver". A frontend test showed that Packages Mall's nearest *available Economy car* is about 5.4 km away, because Hamza, about 3.1 km away, is seeded offline. The DHA Comfort car, about 3.3 km away, covers it for Economy rides, so riders there do get an ETA. `frontend/tests/unit/demo-data.test.ts` now checks the coverage claim against the backend seed, and also checks that Comfort still has gaps.
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

## D23. Containers get an explicit environment and least privilege
- **Blueprint:** compose passes credentials via `env_file`.
- **Decision:** each service declares exactly the variables it needs under `environment:`, interpolated from the root `.env`. For example, the backend's `DATABASE_URL` is assembled from `POSTGRES_*`. App containers also run:
  - as the non-root `node` user;
  - with a read-only root filesystem (`/tmp` is a tmpfs);
  - with `cap_drop: [ALL]` and `no-new-privileges`;
  - with `init: true`, so SIGTERM is forwarded and child processes are reaped.
  The app's files are owned by root, so even the app user cannot modify its own code.
- **Why:** an `env_file` would hand every variable (e.g. the frontend's settings) to every container. Explicit mapping documents each service's real configuration. The hardening costs nothing, because the API never writes to disk.
- **Image build:** `backend` builds `ride-booking-backend:local` once. `migrate` reuses it with `pull_policy: never`, which avoids a duplicate build and export of the same tag.

## D24. Frontend toolchain: the Next 16 scaffold's defaults, with TypeScript 5.9
- **Decision:** `create-next-app@16` with TypeScript, Tailwind 4, ESLint and the App Router. Three choices on top of the scaffold:
  - **ESLint 9:** kept as the scaffold pins it, because `eslint-config-next` 16.4 is built against it. It includes the React Compiler–based `react-hooks` rules. Added rules: `no-explicit-any`, `eqeqeq` and `consistent-type-imports`, with `--max-warnings 0`.
  - **TypeScript 5.9, while the backend uses 6.0:** `openapi-typescript` 7 requires `typescript ^5`. Strictness goes beyond the scaffold with `noUncheckedIndexedAccess` and `noImplicitOverride`.
  - **Tests:** Vitest 5 with jsdom, React Testing Library and MSW, as the blueprint specifies. Prettier uses the shared root config.
- **Also:**
  - **React Compiler:** declined.
  - **`agentRules: false`:** stops `next dev` from writing an `AGENTS.md` into the repo.
  - **`typecheck` script:** runs `next typegen` first, because Next 16's `PageProps`/`LayoutProps` route types are generated.
  - **`output: 'standalone'`:** for the Docker image in Phase 7.
- **Why:** the same reasoning as D13. The scaffold's versions are the ones its config is tested against. The only forced change is the TypeScript major, which the type generator dictates.

## D25. One demo identity per role, stored per role
- **Blueprint:** a single "Switch user" selector in `localStorage`.
- **Decision:** two independent choices:
  - **The rider** ("Riding as", in the header) lives in `localStorage`, so it is shared by every tab.
  - **The driver** (picked inside the driver console) lives in `sessionStorage`, so it is per tab.
  Both are read through `useSyncExternalStore`, where the server snapshot is "no identity yet". Queries wait until the browser's stored value is known. Storage access is wrapped in try/catch, with an in-memory fallback.
- **Why:**
  - Riders and drivers are different people. With one shared selector, opening the driver console in a second tab would change who the rider tab acts as.
  - A per-tab driver lets two tabs act as two drivers racing for the same ride, which is the demo of the core concurrency guarantee.
  - Waiting for the stored identity means no request is ever sent as the wrong user, and there is no hydration mismatch.

## D26. Idempotency key per intent, held in a small pure class
- **Blueprint:** a key from `crypto.randomUUID()`, kept in a `useRef`/state for the intent and regenerated after success or a form change. The plan named a `useIntentKey` hook.
- **Decision:** `IntentKeyStore` (`lib/idempotency.ts`) maps an intent *fingerprint* to one key. The fingerprint is canonical JSON of the rider id plus the request body. The booking form owns one instance:
  - the same trip reuses the key on every retry;
  - a different trip, category or rider gets a new key;
  - `reset()` after a success ends the intent.
  A synchronous in-flight guard blocks a second click that lands before React re-renders the disabled button. An error from an earlier intent is hidden as soon as the form changes, because the request state is matched against the current fingerprint rather than cleared in an effect.
- **Fallback:** `crypto.randomUUID` only exists in secure contexts. Opening the app over a plain-HTTP LAN address therefore uses a `getRandomValues`-based v4 UUID.
- **Why:** a plain class can be unit-tested without React, and keying on the fingerprint makes "a changed form means a new intent" automatic rather than something each caller must remember.

## D27. Retry, polling and failure policy in the UI
- **Queries:**
  - retry up to 3 times, with exponential backoff (1 s, 2 s, 4 s), and only on transient failures (no response, or 5xx);
  - a 4xx answer is final.
- **Mutations:** never retry automatically. The UI offers an explicit Retry, which for `POST /rides` reuses the same Idempotency-Key.
- **Ride polling:**
  - every 3 s while the ride can still change;
  - stops for good on a terminal status or on a definitive error (404, 403);
  - every 10 s while the server is unreachable;
  - paused while the tab is hidden (TanStack Query's default).
  The "Reconnecting…" banner keeps the last known status visible. Its "Retry now" button stays enabled during the automatic retries and cancels the backoff wait.
- **Ride not found:** a malformed ride id gets a real HTTP 404 from the page itself. An unknown or not-visible ride id shows "Ride not found".
- **Why:** this implements blueprint 5.4.4's error matrix. An earlier version disabled "Retry now" during automatic retries, which made it unclickable for almost the whole outage. The browser run in Phase 6 caught that.

## D28. Browser-side hardening and small frontend choices
- **Security headers** on every page:
  - a Content-Security-Policy whose `connect-src` allows only the app and the API origin (taken from `NEXT_PUBLIC_API_BASE_URL` at build time, which also fails the build if the URL is malformed);
  - `X-Frame-Options: DENY`, `nosniff`, a strict `Referrer-Policy`, and a `Permissions-Policy` that disables the camera, microphone and geolocation;
  - no `X-Powered-By`.
  `script-src` still needs `'unsafe-inline'` for Next's bootstrap scripts, because nonces are not set up. This is a known limitation. Production builds do not allow `'unsafe-eval'`.
- **API calls:** sent with `credentials: 'omit'`, because there are no cookies to send.
- **System font stack:** the scaffold's Google Fonts are not used, so neither the build nor the browser downloads fonts. Builds are reproducible offline.
- **Native `<dialog>`** for confirmations: the browser provides the focus trap, the inert background and Escape handling. jsdom lacks `showModal`, so the test setup stubs it.
- **Light theme only.** Text colours were picked for WCAG AA contrast; for example, white on the emerald-700 buttons is about 5.5:1. There has been no formal audit. Status is never shown by colour alone: steps have text and check marks, and availability has a label.
- **Code layout differences from blueprint 5.1:**
  - hooks are grouped into `hooks/use-rides.ts` and `hooks/use-driver.ts` rather than one file each;
  - the actor switcher is `RiderSwitcher` (header) plus the driver picker in the console;
  - pure UI logic sits in its own `lib` modules (`booking-state`, `ride-status`, `map-projection`, `persisted-choice`, `format`) so it can be unit-tested without rendering.

## D29. Frontend container: the API URL is a build argument, and the runtime is locked down like the backend
- **Decision:**
  - `frontend/Dockerfile` builds Next's `standalone` output on `node:24.19.0-alpine` and runs `node server.js` as `node`. The files are root-owned, as for the backend (D23).
  - `NEXT_PUBLIC_API_BASE_URL` is a **build argument**. Compose passes it from `.env`, defaulting to `http://localhost:3001/api/v1`.
  - The Compose service reuses the hardening anchor (read-only root filesystem, `cap_drop: [ALL]`, `no-new-privileges`, `init`). A tmpfs at `/app/.next/cache` is the only writable place besides `/tmp`.
  - The service has no runtime `environment:`. `PORT`/`HOSTNAME` are set in the image.
  - It starts after the backend is healthy.
  - The health check is a `GET /` with Node's `fetch`.
- **Why:**
  - Next inlines `NEXT_PUBLIC_*` values into the browser bundle at build time, so a runtime variable would have no effect. The value must be the API URL as the user's *browser* sees it, not the in-network `backend:3001`. Changing it means rebuilding, which `.env.example` and the README call out.
  - The Dockerfile copies only `next.config.ts`, `tsconfig.json` and `src/`. With `COPY . .`, the test folder would come along. One test imports the backend's seed file, which is outside the build context, so `next build`'s type check would fail.
  - Alpine keeps the plan's choice. Next's build needs musl-specific native binaries (SWC, Tailwind's oxide, lightningcss), and the lockfile's optional dependencies provided them on the first build.

## D30. Component tests: MSW at the network level, the real query client, and real timers
- **Decision:** the component tests (blueprint 17–20, plus the driver console) render real components:
  - **Network:** MSW 3 (`msw/node`) intercepts `fetch`, so the real API client, error parsing and headers are exercised. `onUnhandledFrame: 'error'` fails any test that makes an unexpected request. That option is MSW 3's name for v2's `onUnhandledRequest`.
  - **Query client:** the app's own `makeQueryClient()` (retry policy, no mutation retries), with only the backoff shortened to 5 ms. One test sets it to 5 s on purpose, to check behaviour *during* the backoff window.
  - **Timing:** the polling interval (50 ms) and the estimate debounce (0) are shortened through `vi.mock('@/lib/config')`. Timers stay real, so "polling stopped" and "polling paused while hidden" are measured as no requests over several intervals.
  - **Fixtures:** typed against the generated OpenAPI types, so a contract change breaks the fixtures at compile time.
- **Why:** the tests check behaviour the user and the backend can observe: requests and headers on the wire, accessible roles and names. They don't check component internals, which keeps them valid through refactors. Fake timers would have to coordinate with TanStack Query's scheduling and MSW's promises; shortened intervals keep the tests simple and fast (about 3.5 s for all 131 tests).
- **Checked by mutation:** five behaviours were broken on purpose, and the tests must fail each time (see AI_DISCLOSURE, Phase 7):
  - the double-submit guard;
  - Idempotency-Key reuse;
  - stopping polling on a terminal status;
  - pausing polling in hidden tabs;
  - "Retry now" being clickable during the backoff.

## D31. End-to-end tests run against the Compose stack, one at a time, and each cleans up after itself
- **Decision:** Playwright runs Chromium against the running Docker stack (`make up`), not a dev server.
  - **Run order:** `workers: 1` and no automatic retries.
  - **Global setup:** checks that the API and web app are reachable (with a "run `make up`" hint), then resets the demo data with `docker compose exec -T backend node dist/seed/seed.js --reset`. `E2E_RESET_CMD` can replace or skip that.
  - **Isolation:** each test uses its own rider and its own trip, and its `afterEach` cancels any ride it left active. Test 21 works whether its driver starts offline or online.
  - **Two extras beyond blueprint 21–23:**
    - **23b, lost response:** `route.fetch()` sends the first `POST /rides` to the real API, which commits the ride. The browser then sees a connection reset. The test asserts that the retry is a `200` replay with `Idempotent-Replayed: true` and the same ride id.
    - **A two-driver race in two browser contexts.**
- **Why:**
  - **Real images:** testing the images a reviewer actually starts catches Docker, CSP and CORS problems that a dev server would hide.
  - **Running one at a time:** the shared database makes parallel tests interfere through driver availability. Per-test cleanup keeps the suite valid in any order and without a reset, which was checked by running the files individually in reverse and forward order with the reset disabled.
  - **Why 23b matters:** blueprint 23's "exactly one ride" would also hold *without* idempotency. The one-active-ride unique index would answer a duplicate with `409 ACTIVE_RIDE_EXISTS`, and the UI would follow it to the existing ride. Only asserting the *replay* proves the Idempotency-Key path itself. Rebuilding the frontend so it sends a new key on every attempt makes both test 23 variants fail.
- **Locators:** role- and test-id-based, scoped by text where needed. Next's production build renders its own empty `role="alert"` route announcer, so a bare `getByRole('alert')` is ambiguous.

## Kept exactly as the blueprint specifies
- An idempotent replay of `POST /rides` returns `200` with `Idempotent-Replayed: true`, not the original `201`.
- Lock order is always ride → driver.
- `POST /rides/{id}/start` exists because `complete` requires `IN_PROGRESS`.
- A driver cancelling an `ASSIGNED` ride moves it to `CANCELLED`, not back into the queue (listed as a known limitation).

## Repository hygiene
- `docs/assessment.pdf` (the employer's brief) is git-ignored and is not part of the submission. Remove the line from `.gitignore` if it should be included.
