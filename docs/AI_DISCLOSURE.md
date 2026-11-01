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
