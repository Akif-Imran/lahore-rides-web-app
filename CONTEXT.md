# Project context: Lahore ride-booking assessment

Continuity file for future sessions and context compactions. Read this first, then `CLAUDE.md`, `docs/blueprint.md` (Step 5 is the build spec) and `docs/DECISIONS.md` (D1–D30).

## Current state (2026-11-01)
- **Done:** Phases 0–7. Each phase is one commit, findable with `git log --oneline` (messages end in `(phase N)`). The whole stack (postgres, migrate, backend, frontend) runs with `docker compose up --build -d --wait`.
- **Next:** Phase 8, Playwright E2E against the Compose stack (blueprint tests 21–23):
  - main flow;
  - cancel flow;
  - error and retry, with exactly one ride created.
  `globalSetup` resets the data with `docker compose exec -T backend node dist/seed/seed.js --reset`.
- **Remaining after that:** Phase 9, covering CI, the README/ARCHITECTURE docs and a hardening sweep. The sweep includes the backend's `npm audit` advisories from node-pg-migrate's `glob`, and the frontend's 16 dev-only ESLint-tooling advisories.
- **Notes for Phase 8:**
  - Chromium for Playwright is already installed locally.
  - Don't screenshot before hydration finishes (wait for `networkidle`); otherwise Playwright's caret hiding causes a false hydration warning.
  - Useful selectors already in the UI:
    - `getByRole('combobox', { name: 'Pickup' | 'Destination' })` plus the options;
    - `getByTestId('ride-status' | 'fare-amount' | 'pickup-eta' | 'receipt-total' | 'offer' | 'driver-active-trip' | 'driver-availability')`;
    - buttons `Request Economy · Rs …`, `Accept ride`, `Start trip`, `Complete trip`, `Cancel ride`.
  - A throwaway 16-check Playwright script from Phases 6–7 lives in the session scratchpad and covers the same flows; reuse its steps.
  - The ride-create rate limit is 10 per minute per rider. E2E runs that book many rides should vary the rider or reset between runs.
- **Full build plan:** `/Users/akif.dev/.claude/plans/docs-assessment-pdf-docs-blueprint-md-i-federated-sunrise.md`

## Working agreements
- **Phases:** work one phase at a time. At the end of each phase, run lint, typecheck and tests, then commit once and stop with a summary for review.
- **Commits:** author `akif.dev <raiden3322@gmail.com>` (repo-local config). Each message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nothing is pushed.
- **Documentation:** record every deviation from the blueprint in `docs/DECISIONS.md`, and AI usage plus how it was verified in `docs/AI_DISCLOSURE.md`.
- **Phase history:** at the end of every phase, append `--- PHASE N SUMMARY ---` plus the final summary to both this file (before the END marker) and `PHASES_SUMMARY.md` (at the end of the file; the user committed it as `db643a1`). Include both in the phase commit.
- **Out of scope:** Docker image size and `node_modules` optimisation. What matters is that the app works and starts cleanly on other machines via `cp .env.example .env && docker compose up --build -d --wait`.

=== COMPLETE PROJECT HISTORY ===

--- PHASE 1 SUMMARY ---
Phase 1 is done and committed as `c7c713d`: the backend scaffold, env config, database layer, migration and seed. Lint, typecheck, format check and all 28 unit tests pass. Stopping here for your review.

**One deviation needs your OK before Phase 2.** Nest 12's scaffold now ships **Vitest + oxlint + native ESM**, not the blueprint's Jest + ESLint. I kept the scaffold's toolchain, after confirming dependency injection works in Vitest and that oxlint rejects `any`, `==` and `var`. The blueprint chose Jest only because it was Nest's default when written, and the frontend uses Vitest anyway, so the repo ends up with one test runner. The reasoning is in [DECISIONS.md](docs/DECISIONS.md) as D13. If you'd rather stick to Jest, say so now: switching gets more expensive once Phase 2 adds its test files.

**What's in place**
- **Config:** [env.schema.ts](backend/src/config/env.schema.ts) validates every environment variable at startup. A bad or missing value stops the boot with exit 1 and names the variable.
- **Database layer:** [transaction-manager.ts](backend/src/database/transaction-manager.ts) wraps work in BEGIN/COMMIT, rolls back on any error, and passes the transaction around explicitly. The pool sets lock and statement timeouts, so a stuck lock fails fast instead of hanging.
- **Migration:** [the initial migration](backend/migrations/1793491200000_init.sql) is the blueprint schema verbatim, plus one CHECK that a driver's lat and lng are both set or both empty. One runner serves the dev command, the Docker `migrate` service and, later, the tests.
- **Seed:** fixed IDs for 3 riders and 6 drivers. Re-running it never changes an existing driver's availability, so it's safe mid-trip; `seed:reset` clears all rides.
- **Health:** `/api/v1/health/live` and `/api/v1/health/ready`. Readiness checks the database.

**Checks against the real Postgres**
- Migrations ran up, down and up again cleanly, and re-running up does nothing. All three "one active…" unique indexes exist.
- Seeding twice gives the same row counts. A manual constraint violation was rejected.
- With Postgres stopped, readiness returns 503 and liveness stays 200; readiness recovers without restarting the API. SIGTERM shuts it down cleanly.

**Bug found and fixed:** the readiness warning was logging an empty reason when the DB was down. A new `describeError()` fixes it, and the log now names both refused addresses.

**Two notes**
- Overall test coverage is 45% for now. The uncovered code is the database-touching parts I checked by hand above; Phase 4's integration tests cover those. The pure logic is at 89–100%.
- `npm audit` flags 3 moderate advisories in production deps, all from `node-pg-migrate`'s `glob` dependency. It only reads our own `migrations/` folder, so I'll deal with it in the Phase 9 hardening sweep.

Next is **Phase 2**: the pure, unit-tested core (error types, ride state machine, distance and service-area checks, fare quotes, driver eligibility). Say continue when ready.

--- PHASE 2 SUMMARY ---
Phase 2 (the backend's business rules) is done and committed as `f9d4f1d`. Typecheck, lint and format check pass, and all 358 unit tests pass. Stopping here for your review.

**What's in place**
- **State machine:** [ride-state-machine.ts](backend/src/rides/ride-state-machine.ts) holds the transition table plus one decide function per action (accept, start, cancel, complete). Each returns *apply*, returns *already done* for a retry by the same party, or throws the exact error. The Phase 3 services will only lock rows and write; every rule lives here.
- **Who can see a ride:** [ride-access.ts](backend/src/rides/ride-access.ts) recognises the ride's rider, its assigned driver, and a driver who could accept it now. Another rider gets 404, so they can't probe which ride ids exist.
- **Driver eligibility:** [eligibility.ts](backend/src/matching/eligibility.ts) has the category rule (Comfort cars can take Economy rides, not the reverse), the location-freshness check and the pickup ETA formula.
- **Fares:** [fare.service.ts](backend/src/fares/fare.service.ts) quotes in whole rupees, with each line rounded so the breakdown adds up to the total. Minimum fare and surge are both supported.
- **Errors and geo:** [the error types](backend/src/common/errors/domain-errors.ts) map to the blueprint's status table. [geo.ts](backend/src/common/utils/geo.ts) and [trip-validation.ts](backend/src/rides/trip-validation.ts) cover distances and enforce the Lahore service area and the 200 m minimum trip.

**How well it's tested**
- The state-machine test lists the allowed transitions separately from the code and checks all 144 combinations of from-status, to-status and caller. It describes the rules rather than copying the implementation.
- I broke three rules on purpose: cancelling a trip in progress, letting Economy cars take Comfort rides, and dropping the minimum fare. The tests caught each one (7, 8 and 2 failures). With the originals restored, everything passes again.
- Fare expectations were worked out by hand from the blueprint formula, e.g. 10 km Economy = 150 + 400 + 125 = Rs 675.
- Every Phase 2 file has 100% line, branch and function coverage.

**Rules I settled where the blueprint was silent** (all in [DECISIONS.md](docs/DECISIONS.md) D15)
- **State before permission:** an impossible move is 409 for everyone; a legal move by the wrong person is 403. That's the split blueprint test 11 expects.
- **Permanent before temporary:** on accept, a wrong-category driver gets 403 before a busy or offline one gets 409, because retrying can never fix the first.
- **"Start trip" can be retried safely,** like accept, cancel and complete.
- **Drivers can view an open ride** if their car category fits. The 5 km offer radius only applies to the offers list.

Next is **Phase 3, the API itself**:
- request logging with request ids and the standard error envelope;
- validation and the rider/driver identity check;
- the SQL repositories and the services, including the row-locking accept flow and idempotent ride creation;
- the controllers, Swagger docs, the expiry sweeper and the OpenAPI export.

It's the largest phase. Say continue when you're ready.

--- PHASE 3 SUMMARY ---
Phase 3, the backend API, is done and committed as `b2c30a9`. Typecheck, lint and format pass, all 453 unit tests pass, and a 49-check smoke test against the real database passes in full. Stopping here for your review.

**What the API does**
- **13 endpoints under `/api/v1`, documented at `/docs`.** `backend/openapi.json` is exported and committed; the export needs no database and comes out identical every time, which the CI drift check relies on.
- **Ride lifecycle:** every state change follows the blueprint's sequence:
  - lock the ride row first, then the driver;
  - let the Phase 2 rules decide whether to apply, return an "already done" retry, or reject;
  - write only if the ride is still in the expected state;
  - unique indexes in the database act as the last backstop.
- **Duplicate requests:** the idempotency key is claimed in the same transaction as the ride insert, so a retry gets back the original response, identical down to the byte.
- **Cross-cutting:** one error format for every failure, with a request id and no leaked internals. Also strict input validation, a rider/driver identity check, per-caller rate limits, request-id-tagged logs, an expiry sweeper, and readiness that turns 503 when the database is down.

**What I checked against the running API**
- **Lifecycle:** request, replay, accept, retried accept, start, complete. Plus a second driver losing the race (409), every invalid move (409/403), and ETag polling returning 304.
- **Error paths:** malformed JSON and unknown routes still get the standard format; every validation, identity and permission error returns the expected status.
- **Rate limit:** the 11th ride request in a minute gets 429 with `Retry-After: 60`, and other riders are unaffected.
- **Expiry:** a ride backdated by 6 minutes expired on the sweeper's next pass, about 9 seconds later.

**Problems found and fixed in this phase**
- **Seed coverage:** with the original seed, Lahore Fort, Badshahi Mosque, the Railway Station and Mall Road had no Economy driver within 5 km. I moved the seeded drivers so every landmark is covered. Comfort still has gaps on the outskirts, since there are only two Comfort cars.
- **Logger startup bug:** the first boot failed because the logger was wired up before every module that uses it had loaded.
- **Two self-review fixes:**
  - a wrongly matched driver could have been shown a ride's details instead of getting 404;
  - the `Location` header was missing `/api/v1`.

**Choices worth a look** (all in [DECISIONS.md](docs/DECISIONS.md) D16–D21)
- **One radius for both the ETA and the offers list,** so a rider is never shown an ETA from a driver who can't see their ride.
- **The driver's live location is only shown during the trip.** After the ride ends, the rider can't keep tracking them.
- **The final fare is `fare.finalTotal`,** not a top-level `finalFare` as the blueprint sketches.
- **The API still accepts a ride when no driver is nearby.** The UI blocks it, and an unaccepted ride expires after the timeout.
- **Rate limits are keyed on the identity header,** which a client can fake in this demo setup. Real authentication fixes that; I've listed it as a limitation.

Next is **Phase 4**, the automated tests against real Postgres: blueprint tests 5–16. That includes 10 drivers racing to accept the same ride 20 times over, 10 identical requests in parallel producing exactly one ride, accept-versus-cancel races, and the expiry sweeper. Say continue when ready.

--- PHASE 4 SUMMARY ---
Phase 4 (integration and concurrency tests) is done and committed as `fd9584e`. 107 integration tests pass against real Postgres on three runs in a row (about 9 s each), and `make test-backend` runs them with the 453 unit tests, all passing. Stopping here for your review.

**What's covered**

| Blueprint test | What's tested |
|---|---|
| 5, 6 | Ride creation saves exactly the fare the rider was shown; every kind of invalid input gets 400 and saves nothing |
| 7 | Accepting a ride; offline, busy, stale-location and wrong-category drivers are rejected; the offers list; availability changes |
| 8 | **10 drivers accept the same ride, 20 times**: always exactly one winner, also with fewer DB connections than requests |
| 9 | One driver accepts two rides at once (×20): they end up on exactly one |
| 10 | Accept vs cancel and start vs cancel races (×20), plus both orderings forced |
| 11 | 18 invalid transitions; the ride, drivers, assignments and fare are **identical** before and after each one |
| 12 | 10 identical requests at once produce **one ride**; a reused key with a different body gets 422; one active ride per rider |
| 13, 14 | The full lifecycle, cancels by rider and by driver, ETag/304; who can see or change which ride |
| 15, 16 | One error format everywhere; internal errors leak nothing; lock timeouts and a down database return a retryable 503; `openapi.json` matches the running app |
| extra | Ride expiry (including expiry racing an accept), rate limits, database constraints checked with raw SQL |

After every race the tests check the database stays consistent, e.g. no driver marked busy without exactly one active ride.

**Evidence the concurrency handling holds up**
- **Each safeguard works on its own.** The design layers three: a row lock, a "change only if still unassigned" update, and a database uniqueness rule. I removed them one at a time. With any one left there was still exactly one winner; with all three gone the tests failed. The code is restored.
- **The blueprint's lock sequence diagram is reproduced exactly.** The test holds the ride's lock, confirms from Postgres that the second driver's accept is waiting on it, lets a competing winner commit, and checks the waiting driver then gets "already assigned".
- **I found one race test that wasn't really racing.** Accept-vs-cancel only ever ran in one order. It now alternates which request goes first, so both orders occur, and two more tests force each order exactly.

**One deviation from the blueprint** ([DECISIONS.md](docs/DECISIONS.md) D22): test 10 expects accept and cancel to never both succeed. But the blueprint's own rules let a rider cancel an assigned ride, so "accepted, then cancelled" is a correct result. The test checks both orders end consistently, and a separate start-vs-cancel race covers the case where "never both" genuinely applies.

Integration tests cover 93% of the backend's lines; the rest is covered by unit tests or is scripts.

Next is **Phase 5**: the backend Dockerfile (non-root, health check), the one-shot `migrate` service, and the backend running in Compose, rebuilt from scratch to confirm it's reproducible. Say continue when ready.

--- PHASE 5 SUMMARY ---
Phase 5 is done and committed as `46d2182`: the backend now runs in Docker and starts from scratch with the documented commands. Stopping here for your review.

**How it starts**
- `cp .env.example .env && docker compose up --build -d --wait` (or `make up`) starts three services in order:
  1. **postgres**, which waits until healthy;
  2. **migrate**, a one-shot job that applies migrations and seeds the demo data, then exits;
  3. **backend**, which only starts once migrate has finished successfully.
- This mirrors how migrations run as a pre-deploy step in production.

**What I checked**
- **From nothing:** I deleted the containers, the database volume and the image, then ran the startup command. Everything came up healthy in about 17 s; a machine with no Docker cache needs about a minute for the first build. Both databases were created and the demo riders and drivers were seeded.
- **Against the container:** the 49-check smoke test passes. Restarting re-runs migrate harmlessly and keeps the data, and `make seed` / `make seed-reset` work.
- **Shutdown:** stopping the backend exits cleanly in under a second, rather than being force-killed after Docker's 10 s timeout.
- **Lockdown, confirmed inside the running container:** the app runs as a non-root user, can't modify its own code, has a read-only filesystem apart from `/tmp`, and has no extra Linux privileges.
- **Tests:** the 453 unit and 107 integration tests still pass.

**Changes made during the phase**
- The first Compose file built the same image twice, once per service. Now `backend` builds it and `migrate` reuses it.
- Each container gets only the environment variables it needs, rather than the whole `.env` file ([DECISIONS.md](docs/DECISIONS.md) D23).
- As you asked, I reverted the image-slimming attempt and left the size as is. The AI disclosure notes that it was tried and dropped.

Next is **Phase 6**: scaffolding the Next.js frontend, then building the booking page, the ride status page and the driver console. API types will be generated from `openapi.json`. Say continue when ready.
--- PHASE 6 SUMMARY ---
Phase 6, the frontend, is done and committed as `feat(frontend): booking, ride status and driver console pages (phase 6)`. Lint, typecheck, format check, 85 unit tests and `next build` all pass. A scripted browser run (16 checks) passed against both the dev server and the production build. Stopping here for your review.

**What's in place**
- **Three pages:**
  - `/`: booking, with landmark search, Economy/Comfort with both prices, a live fare and ETA, and "Resume your ride";
  - `/ride/[id]`: live status, driver card, map placeholder, cancel with confirmation, then a receipt or a cancelled/expired view;
  - `/driver`: a simulation console to go online, see nearby requests, accept, start, complete or cancel.
- **API contract:** types are generated from `backend/openapi.json`, so a backend change shows up as a frontend type error.
- **Safe retries:** one Idempotency-Key per ride request, reused on every retry and replaced when the trip changes. Double clicks are blocked.
- **Every failure has a defined behaviour** (blueprint 5.4.4):
  - field errors under the inputs;
  - "Another driver took this ride" for a lost race;
  - a countdown on rate limits;
  - "Reconnecting…" that keeps the last known status while the server is unreachable;
  - "Ride not found" for unknown rides;
  - a request id shown on server errors.
- **Cheap polling:** every 3 s, with `If-None-Match`/304 handled explicitly. It stops on terminal states and pauses in hidden tabs.

**Checked in a real browser** (dev, then the production build with strict security headers):
- booking showed Rs 767, which matches a hand calculation;
- a failed request retried with the same Idempotency-Key and created one ride;
- a second browser acted as the driver through to completion, and the receipt equalled the quote;
- polling stopped afterwards;
- the outage banner recovered;
- the cancel flow worked, and phone-width layouts fit with no horizontal scroll.

**Found and fixed during the phase**
- "Retry now" couldn't be clicked during automatic retries.
- The error page used the wrong prop for Next 16.4 (`reset` instead of `retry`); caught by checking Next's bundled docs.
- `next dev` was writing an `AGENTS.md` into the repo.
- A new coverage test showed DECISIONS D17 was worded imprecisely. Packages Mall's Economy riders are covered by a Comfort car; D17 is corrected and now enforced by that test.

**Choices worth a look** (DECISIONS D24–D28, plus D12 updated)
- TypeScript 5.9 in the frontend, forced by the type generator.
- The rider identity is shared across tabs, but each driver-console tab is its own driver, so two tabs can race for a ride.
- Strict security headers in production, with no font downloads at build time.

Next is **Phase 7**:
- component tests for the booking form, fare card, the idempotent retry and ride polling (blueprint tests 17–20);
- the frontend Dockerfile and its Compose service, so `docker compose up` runs the whole stack.

--- PHASE 7 SUMMARY ---
Phase 7 is finished and committed as `test(frontend): component tests and frontend Docker image (phase 7)`. The whole app now starts with one command, and the frontend's behaviour under failure is covered by tests. Stopping here for your review.

**Component tests:** 46 new, 131 frontend tests in total, about 3.5 s.

| Blueprint test | What's covered |
|---|---|
| 17, booking form | Request stays disabled until the trip is valid and priced; the same pickup and destination is rejected without asking for a fare; an empty field is explained when left; only listed landmarks are accepted; keyboard use of the location picker; swap; "View ride" and a blocked second booking while a ride is active |
| 18, fare card | Loading skeleton; fare, ETA and the other category's price; "No drivers nearby" with a hint about the other category; error with Retry. In the form: a 5xx is retried 3 times before the error shows and Retry recovers; a 4xx is not retried |
| 19, request flow | Spinner and locked form; one request on a double-click, and on two submits faster than a re-render; after a network error or a 5xx, Retry sends the **same Idempotency-Key**; a changed trip gets a new key; 409 opens the existing ride; 400 shows field errors; 429 shows a countdown |
| 20, ride status | Every status renders, with Cancel only where allowed; polling follows the ride to the end and then stops; polling pauses in a hidden tab; "Reconnecting…" keeps the last status, and "Retry now" works mid-backoff; cancel with confirmation; 409 on cancel; not found; a failed first load recovers on Retry |
| extra, driver console | Marked as a simulation; a lost race shows "Another driver took this ride."; going online; start, then complete |

The tests mock the API at the network level with MSW and use the app's real query client. That means the real API client, headers and retry rules run in every test.

**Checking the tests themselves:** I broke five behaviours on purpose, one at a time. Four were caught straight away. Making "Retry now" unclickable during automatic retries was not. The test's fast retry setting meant it clicked after the retries had finished, never during the window where the original bug lived. I strengthened that test, and it now catches the break.

**Docker**
- `docker compose up --build -d --wait` now starts four services in order: postgres, migrate, backend, frontend, each waiting for the one before.
- **From nothing:** with the containers, the database and both images deleted, everything was healthy in 23 s, using a warm build cache. A machine with no Docker cache needs a few minutes for the first build.
- **Locked down like the backend:** the frontend container runs as a non-root user, on a read-only filesystem apart from `/tmp` and Next's cache, with no Linux privileges. It stops cleanly in about 0.2 s.
- The same 16-check browser run passed against the container, both before and after the from-scratch rebuild.
- The backend still passes its 453 unit and 107 integration tests against the recreated database.

**Choices worth a look** (DECISIONS D29–D30)
- **The API URL is baked into the frontend at build time.** Next requires this for settings the browser uses, so changing it needs `docker compose up --build`. `.env.example` and the README say so.
- **The tests use real timers with shortened intervals** rather than fake timers. That keeps them simple and fast, and the mutation check shows they still catch regressions.

Next is **Phase 8**: Playwright end-to-end tests against the running stack. These are the main booking flow with a second browser acting as the driver, the cancel flow, and a forced failure followed by a retry that creates exactly one ride (blueprint tests 21–23). Say continue when you're ready.

=== END OF COMPLETE HISTORY ===
