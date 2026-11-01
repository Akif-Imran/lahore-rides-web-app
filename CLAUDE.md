# Ride-booking assessment (Lahore)
Source of truth: @docs/blueprint.md (Step 5 is the build spec) and docs/assessment.pdf (original requirements).
Stack: Next.js + TS in /frontend, Nest.js + TS in /backend, PostgreSQL, Docker Compose.

## Rules
- Follow blueprint Step 5 exactly; if you deviate, say why in docs/DECISIONS.md.
- SQL only in repositories; business logic only in services and the state machine.
- Never commit secrets; only .env.example with dummy values.
- Work in phases. After each phase: run lint, typecheck and tests, then stop and summarize.
- Log what AI generated and how it was verified in docs/AI_DISCLOSURE.md.