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
