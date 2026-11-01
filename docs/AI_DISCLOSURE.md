# AI tool disclosure

## Tools used
- **Claude Code** (Anthropic, Claude Opus 5.5), used inside VS Code as a coding agent.
- `docs/blueprint.md` was generated with an AI assistant from the assessment brief and used as the build spec.

## How AI was used
The build followed the phased plan in `docs/blueprint.md` (Step 5). In each phase the agent generated the code and configuration. A phase was committed only after its checks passed: lint, typecheck and tests, plus the phase-specific checks below. Any departure from the blueprint is recorded in `docs/DECISIONS.md`.

## Verification log
One entry per phase: what was generated, and how it was verified.

### Phase 0: Repository foundation
- **Generated:** `.gitignore`, `.editorconfig`, `.prettierrc`, `.nvmrc`, `.env.example`, `docker-compose.yml` (Postgres only), `docker/postgres/init/01-create-test-db.sh`, `Makefile`, and stubs for README, DECISIONS and this file.
- **Verified:**
  - `docker compose config --quiet` passes.
  - `docker compose up -d --wait postgres` reports healthy (PostgreSQL 16.15), and `pg_database` lists both `ridebooking` and `ridebooking_test`.
  - `git check-ignore` confirms `.env`, `docs/assessment.pdf`, `.DS_Store` and `.claude/settings.local.json` are ignored, and `git status` shows only intended files.
  - `make help` lists every target.

### Phase 1: Backend scaffold, config, database layer, migrations, seed
- **Generated:**
  - the Nest 12 scaffold (CLI), with sample code removed;
  - the zod env schema and typed config module;
  - the pg pool provider, `Queryable`, `TransactionManager` and migration runner;
  - the initial SQL migration;
  - seed data, seed repository, seeder and CLIs;
  - the health endpoints, `configureApp` and `main.ts`;
  - unit tests for config, the transaction manager, seed data and `describeError`.
- **Verified:**
  - Checked that the scaffold's Vitest/oxlint toolchain works before adopting it: DI works in tests, and an oxlint probe file confirmed `any`, `==` and `var` are rejected.
  - `typecheck`, `lint`, `format:check` and `test` all pass (28 tests).
  - Against the real Postgres: `migrate:up`, then `migrate:down` (0 app tables left), then `migrate:up`. A repeated `up` is a no-op, and all three partial unique indexes exist.
  - `seed` run twice gives identical counts. The default seed leaves a manually changed driver availability untouched, and `seed:reset` restores it.
  - A manual constraint violation (lat without lng) is rejected by `chk_driver_location_pair`.
  - On the built app: `/health/live` and `/health/ready` return 200. Stopping Postgres turns readiness into 503 while liveness stays 200, and readiness recovers when Postgres restarts. SIGTERM exits cleanly, and missing or invalid env vars abort startup with exit 1 and a list naming each variable.
  - **Bug found and fixed during verification:** the readiness warning logged an empty message, because `localhost` resolves to both `::1` and `127.0.0.1` and the refusal arrives as an `AggregateError` with no message. Added `describeError()` with tests, and now the log reads `connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432`.

### Phase 2: Pure domain core
- **Generated:**
  - error codes and the `DomainError` hierarchy;
  - ride statuses and the ride state machine (transition table, `assertTransition`, `decideAccept/Start/Cancel/Complete`);
  - ride access rules;
  - geo helpers and trip validation;
  - fare config and quotes;
  - driver eligibility and the ETA formula;
  - unit tests for all of the above (330 new tests, 358 in total).
- **Verified:**
  - The state-machine spec lists the permitted `(from, to, actor)` triples independently of the implementation's table, then checks all 144 combinations. It is a specification, not a copy of the code.
  - **Mutation check.** Three rules were broken on purpose and the suite caught each one:
    - allowing cancel while `IN_PROGRESS`: 7 tests failed;
    - inverting the category rule: 8 tests failed;
    - dropping the minimum fare: 2 tests failed.
    The originals were then restored, and all tests pass again.
  - Fare expectations were worked out by hand from the blueprint formula (e.g. 10 km Economy = 150 + 400 + 125 = Rs 675) rather than copied from the implementation's output. Distances are checked against independent geometry: 1° of latitude ≈ 111.195 km, and longitude scales with cos(latitude).
  - 100% line, branch and function coverage on every domain file (JSON coverage summary). `typecheck`, `lint` and `format:check` pass.

### Phase 3: Backend API
- **Generated:**
  - repositories (raw SQL with a Haversine SQL fragment that mirrors the TypeScript one);
  - the error mapper and global filter, validation pipe, request ids, structured logging, rate limiting and the actor guard;
  - the idempotency, matching, rides, drivers and fare-estimate services;
  - controllers, DTOs and Swagger, the expiry sweeper, the OpenAPI export;
  - unit tests for the new pure modules (95 new, 453 in total).
- **Verified:**
  - **Seed coverage analysis (before writing the matching code).** A script measured the 5 km coverage of the 12 frontend landmarks. The blueprint's seed left Lahore Fort, Badshahi Mosque, the Railway Station and Mall Road without an Economy driver, so the positions were changed (DECISIONS D17).
  - **First boot found a DI bug.** nestjs-pino only creates providers for `@InjectPinoLogger` contexts registered *before* `LoggerModule.forRootAsync()` runs, and ESM import order made that call too early. Fixed by building the logger module lazily in `AppModule.forRoot()`.
  - **Self-review fixes:**
    - in `start`/`complete`, a null actor would have returned ride details instead of 404;
    - the `Location` header dropped the `/api/v1` prefix.
  - **49-check curl smoke test** against the real database, all passing:
    - the full lifecycle and the idempotent replays, with a byte-identical replayed body;
    - 422 for a reused key and 409 for an active ride;
    - 304 via ETag;
    - every 400/401/403/404/409 path;
    - malformed JSON and unknown routes return the envelope with a request id;
    - `X-Request-Id` propagation, CORS preflight, helmet headers, and `/docs`.
  - **Rate limit with the real default.** The 11th ride creation in a minute got `429` with `Retry-After: 60`; another rider was unaffected. (The first smoke run tripped the limit across two quick runs, which confirmed it works.)
  - **Expiry sweeper on the live server.** A ride backdated by 6 minutes became `EXPIRED` on the next tick (~9 s), and the rider could book again.
  - **OpenAPI export.** Runs with no database and is byte-identical across two runs, which the CI drift check needs. Nullable references use the OpenAPI 3.0 `allOf` form.
  - Structured logs carry the request id on business events (`ride.assigned`, …) and `errorCode` on 4xx lines.
  - `typecheck`, `lint` and `format:check` pass. The new pure modules have 91–100% line coverage; the remaining wiring is covered by Phase 4's integration tests.

### Phase 4: Integration and concurrency tests (real PostgreSQL)
- **Generated:**
  - the integration harness: real `AppModule` + `configureApp`, ephemeral port, test database, global migrations, and a guard that refuses any database not named `*_test`;
  - fixtures, factories, an error-envelope schema, and a SQL invariant checker;
  - 12 spec files, 107 tests covering blueprint tests 5–16, the expiry sweeper, rate limiting and database-level constraints.
- **Verified:**
  - **Consistency across runs:** `npm run test:int` passed three full runs in a row (~9 s each), then again via `make test-backend`.
  - **Defence-in-depth mutation check** on the 10-driver race:
    - without the row lock (`FOR UPDATE`), still exactly one winner, held by the compare-and-swap `UPDATE`;
    - without the lock *and* the CAS, still one winner, held by the partial unique index;
    - without the assignment insert as well (no index backstop), the tests **fail** and detect multiple winners.
    Source was restored, `git diff` was empty, and the tests pass again.
  - **A race that wasn't racing:** the first accept-vs-cancel version only ever produced one interleaving. Fixed by alternating which request is sent first, so both orders now occur. Two deterministic tests also force each order by holding the row lock and checking via `pg_stat_activity` that the requests are queued behind it.
  - **The blueprint's sequence diagram 4.5, reproduced deterministically:** a second accepter blocks on the ride lock, then sees the committed winner and gets `409 RIDE_ALREADY_ASSIGNED`.
  - **Mistakes caught during the phase** (test code, not app code):
    - typecheck caught helper calls with a missing `pool` argument;
    - one test wrongly assumed which CHECK constraint Postgres would report when a value violates two.
  - Integration coverage is 93% of lines in `src`; the gaps are covered by unit tests or are scripts.

### Phase 5: Backend Docker and Compose
- **Generated:** the multi-stage `backend/Dockerfile` and `.dockerignore`; the `migrate` one-shot and `backend` services; container hardening (D23).
- **Verified:**
  - **From scratch:** `docker compose down -v`, image deleted, then `docker compose up --build -d --wait`. The order held: postgres healthy, then migrate applied the migration and seeded and exited 0, then the backend became healthy. The test database was created. About 17 s with a warm build cache; a cold build takes about a minute.
  - **49-check smoke test against the container:** all passed.
  - **Restart:** a second `up` re-ran migrate as a no-op and kept the data. `make seed` and `make seed-reset` work inside the read-only container.
  - **Hardening, checked inside the running container:**
    - the process runs as `uid=1000(node)` under `docker-init`;
    - writes to app code are denied, the root filesystem is read-only, and only `/tmp` is writable;
    - `CapEff` is 0 and `NoNewPrivs` is 1;
    - logs are JSON.
  - **Graceful shutdown:** `docker compose stop backend` returned in under 1 s with exit code 143 (SIGTERM handled, not a forced kill).
  - **Build:** the first compose file built and exported the same image twice (once per service); fixed with a single build plus `pull_policy: never`. Rebuilding after deleting the image confirmed compose still builds it before migrate starts.
  - Unit and integration suites (453 + 107) still pass against the re-created test database.
  - **Not pursued:** an attempt to slim the image with `npm ci --omit=peer` grew `node_modules` instead (135 MB to 253 MB). It was reverted, and image size was left as is at the user's request.

### Phase 6: Frontend scaffold, foundations and pages
- **Generated:**
  - the Next.js 16 scaffold (`create-next-app`, flags checked with `--help` first, React Compiler and `AGENTS.md` declined), with sample files removed;
  - config (strict TypeScript, ESLint rules, security headers, standalone output, Vitest);
  - `src/types/api.gen.ts`, generated by `openapi-typescript` (tool output, not AI), plus friendly aliases;
  - `lib/`:
    - the typed API client: timeout, error envelope parsing, ETag cache;
    - endpoint functions, error copy, the idempotency intent store, the query client and retry policy;
    - `deriveBookingState`, the ride-status and polling policy, map projection, the demo actors and the landmarks;
  - hooks for identity, estimates, rides and the driver console;
  - 22 component files, three pages, and the not-found and error pages;
  - 85 unit tests for the pure modules.
- **Verified:**
  - **Contract:** `api.gen.ts` matches a fresh generation from `backend/openapi.json` byte for byte. A unit test imports the backend seed file and fails if the frontend's demo actors drift from it.
  - **Gates:** lint (`--max-warnings 0`), typecheck, format check, 85 unit tests and `next build` all pass.
  - **Version-specific APIs checked against Next's bundled docs** (`node_modules/next/dist/docs`) rather than memory. This caught that the `error.tsx` boundary's prop in Next 16.4 is `retry`; the generated page used `reset`, which only clears the error and is not the recommended prop.
  - **Scripted browser run** (Playwright driving Chromium against the dockerised backend), 16 checks. It ran against the dev server, then again against the standalone production build with the production CSP. All 16 passed both times:
    - booking Liberty Market → Lahore Fort shows Rs 767 and a 7-minute pickup ETA, matching a hand calculation (9.04 km × 1.3 = 11.75 km; 150 + 470 + 147);
    - the same pickup and destination are blocked inline;
    - the first `POST /rides` was aborted at the network level; **the Retry sent the same `Idempotency-Key`** and created the ride;
    - a second browser context, as a driver on a phone-sized viewport, accepted, started and completed the ride, and the rider page followed each status, with the driver card and the driver dot on the map;
    - forced polling outage: "Reconnecting…" kept the last status visible, and "Retry now" recovered in under 100 ms once the network was restored;
    - Cancel is hidden once the trip starts, the receipt total equals the quoted fare, and polling sends **zero** requests after completion;
    - "Resume your ride" appears after navigating away, the cancel dialog focuses "Keep ride", and a cancelled ride leaves the driver's offers;
    - a malformed ride id returns HTTP 404, and an unknown one shows "Ride not found";
    - no horizontal scroll at 375 px.
    The only console errors in both runs were the four the script caused on purpose: two aborted requests and two 404s.
  - **Screenshots reviewed** at 1280 px and 375–390 px for the booking page, ride states, cancel dialog, receipt and driver console.
  - **Problems found and fixed during verification:**
    - "Retry now" was disabled during TanStack Query's automatic retries, so it could not be clicked for most of an outage. It now stays enabled and cancels the backoff.
    - The `error.tsx` prop was wrong (`reset` instead of `retry`), as above.
    - `next dev` wrote an `AGENTS.md` into the repo even though it was declined at scaffold time. Fixed with `agentRules: false`.
    - The React Compiler lint rule rejected a ref read inside a `handleSubmit(...)` callback created during render. The handler is now built per event, with no suppression comment.
    - Map labels sat on the route line for east–west trips, and the phone-width header wrapped awkwardly. Both fixed and re-checked by screenshot.
    - **A wrong claim in the docs:** the new coverage test showed DECISIONS D17's "every landmark has an Economy driver within 5 km" was imprecise (Packages Mall relies on a Comfort car). The app was right; D17 was corrected and the test now enforces the accurate claim.
  - **A false alarm, investigated:** one run logged a hydration-mismatch warning about an inline `caret-color` style. A page load with no screenshot gave no warning on any page. The cause was the test script screenshotting before hydration finished, not the app, so the script now waits for network idle first.
  - **Dependencies:** `npm audit --omit=dev` reports 0 production vulnerabilities in the frontend. 16 moderate advisories are in dev-only ESLint tooling and go to the Phase 9 sweep.

### Phase 7: Frontend component tests and frontend Docker
- **Generated:**
  - test helpers: the MSW server lifecycle, an error-envelope builder, a render helper using the app's real query client, typed fixtures, and booking-flow helpers;
  - 46 component tests in five files:
    - blueprint 17: booking-form validation, 7 tests;
    - blueprint 18: fare-card states, 9 tests;
    - blueprint 19: the request flow and Idempotency-Key reuse, 9 tests;
    - blueprint 20: ride status and polling, 17 tests;
    - the driver console, 4 tests;
  - `frontend/Dockerfile`, `frontend/.dockerignore`, the `frontend` Compose service, and README/`.env.example` updates.
- **Verified:**
  - **Library API checked, not assumed:** MSW 3's type definitions showed the strict-mode option is now `onUnhandledFrame`, not v2's `onUnhandledRequest`, so the code uses the v3 name.
  - **Mutation check of the tests.** Five behaviours were broken in the source, one at a time; each must make a test fail. The source was restored from git after each.
    - removing the double-submit guard: 1 test failed;
    - minting a new Idempotency-Key on every attempt: 3 failed;
    - polling past a terminal status: 1 failed;
    - polling while the tab is hidden: 1 failed;
    - disabling "Retry now" during automatic retries: **0 failed at first**. The reconnect test used a 5 ms backoff, so the retries were over before it clicked, and it never exercised the window where the original bug lived. The test now runs with a 5 s backoff and checks that the button is enabled and recovers within 1 s, which only a working manual retry can do. That mutation now fails it.
  - **Gates:**
    - frontend: lint, typecheck, format check and 131 tests (85 unit + 46 component, about 3.5 s);
    - backend: lint, typecheck, 453 unit and 107 integration tests, re-run after the database volume was recreated.
  - **Docker, from nothing:** `docker compose down -v`, both images deleted, then `docker compose up --build -d --wait`. The order held: postgres healthy, migrate (migration plus seed, exit 0), backend healthy, frontend healthy. It took 23 s with a warm build cache. The Alpine build found the musl native binaries for Next, Tailwind and lightningcss in the lockfile on the first try.
  - **Hardening, checked inside the running frontend container:**
    - it runs as `uid=1000(node)` under `docker-init`;
    - the app files are root-owned, and writing to them or to `/etc` fails with "Read-only file system";
    - only `/tmp` and `/app/.next/cache` are writable;
    - `CapEff` is 0 and `NoNewPrivs` is 1.
  - **Graceful shutdown:** `docker compose stop frontend` finished in about 0.2 s with exit code 143 (SIGTERM handled). The container came back healthy.
  - **Browser run against the containerised frontend:** the same 16-check Playwright script as Phase 6 passed twice, against the running stack and again against the stack rebuilt from scratch, with only the four console errors the script causes on purpose. The frontend container logged no errors, including no read-only filesystem errors.

### Phase 8: End-to-end tests (Playwright)
- **Generated:**
  - `frontend/playwright.config.ts`: Chromium only, tests run one at a time, no retries, traces and screenshots on failure;
  - a global setup that checks the stack is reachable and resets the demo data;
  - shared helpers: open a rider or driver context, choose a trip, request a ride, API checks, and per-test cleanup;
  - five tests:
    - blueprint 21, the main flow;
    - blueprint 22, the cancel flow;
    - blueprint 23, error and retry;
    - 23b, response lost after the ride was committed;
    - a two-driver race;
  - the README section on running them.
- **Verified:**
  - **`make e2e` passed 5/5 in four full runs**, all against the Docker stack and each about 23 s: twice in a row as the plan requires, once after restoring from the mutation check below, and once more on the final code.
  - **Order independence:** each spec file was run on its own, in reverse order and then in forward order, with the reset disabled (`E2E_RESET_CMD=`). All passed. This confirms the per-test cleanup, and that test 21 copes with its driver already being online from an earlier run.
  - **End-to-end mutation check:** the frontend image was rebuilt with the client minting a new Idempotency-Key on every attempt. Both test 23 variants failed, because the retry carried a different key. 23b would otherwise have looked fine to a rider: the backend's one-active-ride rule answers the duplicate with 409 and the UI follows it to the existing ride. Asserting the `200` replay is what catches it. The source was restored from git, the image rebuilt, and the suite passed again.
  - **A first-run failure, investigated:** both test 23 variants failed on the first run with a Playwright strict-mode error. `getByRole('alert')` also matched Next's empty `role="alert"` route announcer, which only exists in production builds. The fix was to scope the locator by the banner's text; the app was unchanged.
  - **What the extra tests check on the real stack:**
    - **lost response (23b):** the ride was committed (`201`), the browser saw a connection reset, the retry was a `200` with `Idempotent-Replayed: true` and the same ride id, and the API reports exactly that ride as the rider's active ride;
    - **driver race:** exactly one browser shows "Ride accepted" and the other "Another driver took this ride.", and the API confirms the winner is the ride's driver.
  - **Gates unchanged:** frontend lint, typecheck, format check and 131 unit/component tests pass. The E2E files are type-checked as part of `npm run typecheck`.
