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
cp .env.example .env        # local placeholder values only
docker compose up -d --wait postgres
```

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
