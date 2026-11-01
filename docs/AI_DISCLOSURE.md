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
