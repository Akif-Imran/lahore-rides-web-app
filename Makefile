SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help

help: ## List available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example if it does not exist
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example")

up: env ## Build and start the full stack
	$(COMPOSE) up --build -d --wait

down: ## Stop containers (keeps the database volume)
	$(COMPOSE) down

reset: ## Stop containers and delete the database volume
	$(COMPOSE) down -v

logs: ## Tail container logs
	$(COMPOSE) logs -f --tail=100

db: env ## Start only Postgres
	$(COMPOSE) up -d --wait postgres

seed: ## Re-run the idempotent seed against the running stack
	$(COMPOSE) exec -T backend node dist/seed/seed.js

seed-reset: ## Delete all rides and restore seeded drivers
	$(COMPOSE) exec -T backend node dist/seed/seed.js --reset

test-backend: db ## Backend unit + integration tests (starts Postgres if needed)
	cd backend && npm run test && npm run test:int

test-frontend: ## Frontend unit/component tests
	cd frontend && npm run test

e2e: ## Playwright E2E against the running stack (run `make up` first)
	cd frontend && npx playwright install chromium && npm run test:e2e

test: test-backend test-frontend ## All tests except E2E

openapi: ## Export the backend OpenAPI spec and regenerate frontend API types
	cd backend && npm run openapi:export
	cd frontend && npm run gen:api

.PHONY: help env up down reset logs db seed seed-reset test-backend test-frontend e2e test openapi
