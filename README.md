# Ride booking (Lahore)

A simplified ride-hailing app. A rider picks pickup and destination, chooses Economy or Comfort, sees an estimated fare and pickup ETA, requests a ride, and follows its status. Drivers accept, start and complete rides. The backend guarantees that one ride gets exactly one driver, and that retries never create duplicate rides.

**Stack:** Next.js (App Router, TypeScript) · Nest.js (TypeScript) · PostgreSQL 16 · Docker Compose

> Work in progress. The setup, test and API sections are filled in as each build phase lands.

## Prerequisites
- Docker Desktop (or Docker Engine) with Compose v2
- Node.js 24 (see `.nvmrc`), only needed to run the apps or tests outside Docker
- `make` (optional; every target is a thin wrapper around commands listed in the `Makefile`)

## Quick start
```bash
cp .env.example .env              # local placeholder values only
docker compose up --build -d --wait   # or: make up
```

This starts three services in order:
1. **postgres**, which waits until healthy;
2. **migrate**, a one-shot job that applies migrations and the idempotent seed, then exits;
3. **backend**, which waits until healthy.

Then open:
- API: http://localhost:3001/api/v1 (readiness: `/api/v1/health/ready`)
- API docs (Swagger UI): http://localhost:3001/docs, raw OpenAPI at `/docs-json`

Useful commands: `make logs`, `make seed-reset` (deletes all rides and restores the seeded drivers), `make down` (keeps data), `make reset` (also deletes the database volume).

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

## Repository layout
```
backend/            Nest.js API (modular monolith, raw SQL repositories)
frontend/           Next.js rider app and driver console
docker/             Postgres init scripts
docs/               Architecture, decisions, AI disclosure, blueprint
docker-compose.yml  Local stack
Makefile            Shortcuts for common tasks (`make help`)
```

## Documentation
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design, diagrams, answers to the architecture questions (added later)
- [docs/DECISIONS.md](docs/DECISIONS.md): where and why the build departs from the blueprint
- [docs/AI_DISCLOSURE.md](docs/AI_DISCLOSURE.md): AI tools used and how their output was verified
- [docs/blueprint.md](docs/blueprint.md): the engineering blueprint this build follows
