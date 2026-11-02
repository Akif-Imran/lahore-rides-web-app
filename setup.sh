#!/usr/bin/env bash
#
# One-command local setup for the Lahore ride-booking app.
#
#   ./setup.sh                  check prerequisites, create .env files, build and start the
#                               full stack (postgres, migrate, backend, frontend), verify health
#   ./setup.sh --install-deps   also run `npm ci` in backend/ and frontend/ (needed to run the
#                               test suites or develop outside Docker; requires Node.js 24)
#   ./setup.sh --reset          delete the database volume first (fresh demo data)
#   ./setup.sh --help
#
# Safe to re-run: existing .env files are never overwritten, and a running stack is updated in
# place. Works with the bash 3.2 that ships with macOS, and on Linux and WSL2.

set -Eeuo pipefail

readonly MIN_COMPOSE_VERSION="2.17.0"
readonly REQUIRED_NODE_MAJOR=24
readonly MIN_DOCKER_MEMORY_BYTES=$((2 * 1024 * 1024 * 1024))
readonly WAIT_TIMEOUT_SECONDS=600

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT
LOG_DIR="${TMPDIR:-/tmp}"
LOG_FILE="${LOG_DIR%/}/ride-booking-setup.log"
readonly LOG_FILE

INSTALL_DEPS=false
RESET=false

# ---------------------------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m'
  BLUE=$'\033[34m' RESET_STYLE=$'\033[0m'
else
  BOLD='' DIM='' RED='' GREEN='' YELLOW='' BLUE='' RESET_STYLE=''
fi

step() { printf '\n%s==> %s%s\n' "$BOLD$BLUE" "$1" "$RESET_STYLE"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET_STYLE" "$1"; }
info() { printf '  %s•%s %s\n' "$DIM" "$RESET_STYLE" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET_STYLE" "$1"; }

# fail <problem> [how to fix, one line per argument]: print an actionable error and stop.
fail() {
  printf '\n%s✗ %s%s\n' "$RED$BOLD" "$1" "$RESET_STYLE" >&2
  shift
  if [ "$#" -gt 0 ]; then
    printf '%s  How to fix:%s\n' "$BOLD" "$RESET_STYLE" >&2
    for line in "$@"; do printf '    %s\n' "$line" >&2; done
  fi
  printf '\n' >&2
  exit 1
}

on_unexpected_error() {
  printf '\n%s✗ setup.sh stopped unexpectedly at line %s: %s%s\n' \
    "$RED$BOLD" "$1" "$2" "$RESET_STYLE" >&2
  printf '  To see every command, re-run with: bash -x ./setup.sh\n\n' >&2
}
trap 'on_unexpected_error "$LINENO" "$BASH_COMMAND"' ERR

usage() {
  cat <<'EOF'
Usage: ./setup.sh [--install-deps] [--reset] [--help]

Sets up and starts the ride-booking app with Docker Compose:
  1. checks prerequisites (Docker installed and running, Compose v2, free ports, Node.js if needed)
  2. creates .env, backend/.env and frontend/.env.local from their .env.example templates
     (existing files are kept)
  3. builds and starts postgres, migrate (migrations + demo seed), backend and frontend
  4. verifies the API and the web app respond

Options:
  --install-deps   also install backend and frontend npm dependencies (npm ci), so you can run the
                   test suites or the apps outside Docker; requires Node.js 24
  --reset          delete the database volume before starting (all rides are lost; demo data is
                   re-seeded)
  -h, --help       show this help
EOF
}

# ---------------------------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------------------------

# version_ge <have> <need>: true if have >= need, comparing major.minor.patch numerically.
# Tolerates a leading "v" and suffixes such as "2.29.7-desktop.1".
version_ge() {
  local have="${1#v}" need="${2#v}" i h n
  local -a hv nv
  IFS=. read -r -a hv <<<"$have"
  IFS=. read -r -a nv <<<"$need"
  for i in 0 1 2; do
    h="${hv[$i]:-0}"
    n="${nv[$i]:-0}"
    h="${h%%[!0-9]*}"
    n="${n%%[!0-9]*}"
    h="${h:-0}"
    n="${n:-0}"
    if ((10#$h > 10#$n)); then return 0; fi
    if ((10#$h < 10#$n)); then return 1; fi
  done
  return 0
}

# env_get <file> <key> [default]: the value of KEY in a dotenv file (last occurrence wins).
# Reads the file as data; it is never sourced or executed.
env_get() {
  local file="$1" key="$2" default="${3-}" line
  line="$(grep -E "^[[:space:]]*${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  if [ -z "$line" ]; then
    printf '%s' "$default"
    return
  fi
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "${line:-$default}"
}

# port_in_use <port>: true if something accepts TCP connections on localhost:<port>.
port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

port_owner() {
  if command -v lsof >/dev/null 2>&1; then
    { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR == 2 { print $1 " (pid " $2 ")" }'; } || true
  fi
}

compose() { docker compose "$@"; }

# ---------------------------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------------------------
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-deps) INSTALL_DEPS=true ;;
    --reset) RESET=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unknown option: $1" "Run ./setup.sh --help to see the supported options."
      ;;
  esac
  shift
done

cd "$ROOT"
printf '%sRide booking (Lahore): local setup%s\n' "$BOLD" "$RESET_STYLE"
info "Project: $ROOT"

if [ ! -f docker-compose.yml ] || [ ! -f .env.example ]; then
  fail "docker-compose.yml or .env.example is missing next to setup.sh." \
    "Run the script from a complete checkout of the repository (git clone, not a partial copy)."
fi

# ---------------------------------------------------------------------------------------------
# 1. Pre-flight checks
# ---------------------------------------------------------------------------------------------
step "1/5 Checking prerequisites"

if ! command -v docker >/dev/null 2>&1; then
  fail "Docker is not installed (the 'docker' command was not found)." \
    "macOS / Windows: install Docker Desktop: https://docs.docker.com/desktop/" \
    "Linux: install Docker Engine and the Compose plugin: https://docs.docker.com/engine/install/" \
    "Then open a new terminal and re-run ./setup.sh."
fi
ok "Docker CLI: $(docker --version 2>/dev/null | sed 's/^Docker version //' || true)"

# Note for maintainers: bash 3.2 fires the ERR trap for a failing command substitution even
# inside an `if`, so failures are tested with plain commands and output is captured with
# `|| true`.
if ! docker info >/dev/null 2>&1; then
  docker_info_error="$(docker info 2>&1 >/dev/null || true)"
  case "$docker_info_error" in
    *"permission denied"*)
      fail "Docker is running, but this user is not allowed to use it." \
        "Linux: sudo usermod -aG docker \"\$USER\", then log out and back in (or run: newgrp docker)." \
        "Then re-run ./setup.sh."
      ;;
    *)
      fail "Docker is installed but the Docker daemon is not running (or not reachable)." \
        "macOS / Windows: start Docker Desktop and wait until it reports 'Engine running'." \
        "Linux: sudo systemctl start docker" \
        "If you use a remote engine, check DOCKER_HOST / 'docker context ls'." \
        "Then re-run ./setup.sh."
      ;;
  esac
fi
ok "Docker daemon is running"

compose_version="$(docker compose version --short 2>/dev/null || true)"
if [ -z "$compose_version" ]; then
  fail "Docker Compose v2 ('docker compose') is not available." \
    "Update Docker Desktop, or install the Compose plugin: https://docs.docker.com/compose/install/" \
    "The old standalone 'docker-compose' (v1) is not supported."
fi
if ! version_ge "$compose_version" "$MIN_COMPOSE_VERSION"; then
  fail "Docker Compose $compose_version is too old (need $MIN_COMPOSE_VERSION or newer, for 'up --wait')." \
    "Update Docker Desktop, or the Compose plugin: https://docs.docker.com/compose/install/"
fi
ok "Docker Compose $compose_version"

docker_memory="$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)"
case "$docker_memory" in '' | *[!0-9]*) docker_memory=0 ;; esac
if [ "$docker_memory" -gt 0 ] && [ "$docker_memory" -lt "$MIN_DOCKER_MEMORY_BYTES" ]; then
  warn "Docker has only $((docker_memory / 1024 / 1024)) MiB of memory; 2 GiB or more is recommended (Docker Desktop: Settings > Resources)."
fi

node_major=0
if command -v node >/dev/null 2>&1; then
  node_version="$(node --version 2>/dev/null || echo v0)"
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  case "$node_major" in '' | *[!0-9]*) node_major=0 ;; esac
fi
if [ "$INSTALL_DEPS" = true ]; then
  if [ "$node_major" -eq 0 ] || ! command -v npm >/dev/null 2>&1; then
    fail "--install-deps needs Node.js $REQUIRED_NODE_MAJOR and npm, but they were not found." \
      "Install Node.js $REQUIRED_NODE_MAJOR (LTS): https://nodejs.org/ (or: nvm install, using the repo's .nvmrc)" \
      "Or run ./setup.sh without --install-deps: the app itself only needs Docker."
  fi
  if [ "$node_major" -lt "$REQUIRED_NODE_MAJOR" ]; then
    fail "--install-deps needs Node.js $REQUIRED_NODE_MAJOR or newer; found $node_version." \
      "Upgrade Node.js (e.g. nvm install $REQUIRED_NODE_MAJOR && nvm use $REQUIRED_NODE_MAJOR), then re-run."
  fi
  ok "Node.js $node_version and npm $(npm --version)"
elif [ "$node_major" -ge "$REQUIRED_NODE_MAJOR" ]; then
  ok "Node.js v${node_version#v} (only needed for tests and development outside Docker)"
else
  info "Node.js $REQUIRED_NODE_MAJOR not found: fine for running the app in Docker; install it to run the test suites."
fi

if ! command -v curl >/dev/null 2>&1; then
  warn "curl not found: the final HTTP checks will be skipped (Docker health checks still run)."
fi

# ---------------------------------------------------------------------------------------------
# 2. Environment files
# ---------------------------------------------------------------------------------------------
step "2/5 Preparing environment files"

ensure_env_file() {
  local template="$1" target="$2" purpose="$3"
  if [ ! -f "$template" ]; then
    fail "$template is missing." "Restore it from git: git checkout -- $template"
  fi
  if [ -f "$target" ]; then
    ok "$target already exists (kept as is) - $purpose"
  else
    cp "$template" "$target"
    ok "Created $target from $template - $purpose"
  fi
}

ensure_env_file .env.example .env "Docker Compose settings"
ensure_env_file backend/.env.example backend/.env "backend outside Docker and its tests"
ensure_env_file frontend/.env.example frontend/.env.local "frontend outside Docker"

for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
  if [ -z "$(env_get .env "$key")" ]; then
    fail "$key is empty or missing in .env." \
      "Set it in .env (see .env.example for the expected keys), or delete .env and re-run to recreate it."
  fi
done

POSTGRES_PORT="$(env_get .env POSTGRES_HOST_PORT 5432)"
BACKEND_PORT="$(env_get .env BACKEND_HOST_PORT 3001)"
FRONTEND_PORT="$(env_get .env FRONTEND_HOST_PORT 3000)"
API_URL="$(env_get .env NEXT_PUBLIC_API_BASE_URL "http://localhost:3001/api/v1")"
CORS_ORIGINS="$(env_get .env CORS_ORIGINS "http://localhost:3000")"

for port_var in POSTGRES_PORT BACKEND_PORT FRONTEND_PORT; do
  port_value="${!port_var}"
  case "$port_value" in
    '' | *[!0-9]*) fail "$port_var in .env is not a number: '$port_value'." "Use a port such as 5432, 3001 or 3000." ;;
  esac
done

case "$(env_get .env POSTGRES_PASSWORD)" in
  *[@:/?#]*) warn "POSTGRES_PASSWORD contains @ : / ? or #; it is embedded in a postgres:// URL, so use other characters (or URL-encode them)." ;;
esac
case "$API_URL" in
  *":$BACKEND_PORT/"* | *":$BACKEND_PORT") ;;
  *) warn "NEXT_PUBLIC_API_BASE_URL ($API_URL) does not use BACKEND_HOST_PORT ($BACKEND_PORT); the web app may not reach the API." ;;
esac
case ",$CORS_ORIGINS," in
  *":$FRONTEND_PORT,"*) ;;
  *) warn "CORS_ORIGINS ($CORS_ORIGINS) does not include the frontend port $FRONTEND_PORT; the browser may block API calls." ;;
esac
if [ "$POSTGRES_PORT" != "5432" ]; then
  info "POSTGRES_HOST_PORT is $POSTGRES_PORT: for tests outside Docker, use it in DATABASE_URL and TEST_DATABASE_URL in backend/.env."
fi

# ---------------------------------------------------------------------------------------------
# 3. Ports
# ---------------------------------------------------------------------------------------------
step "3/5 Checking ports"

if [ "$RESET" = true ]; then
  info "--reset: stopping the stack and deleting the database volume"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  ok "Previous stack and data removed"
fi

running_services="$(compose ps --status running --services 2>/dev/null || true)"

check_port() {
  local port="$1" service="$2" variable="$3" extra_hint="$4" owner
  if printf '%s\n' "$running_services" | grep -qx "$service"; then
    ok "Port $port is used by this project's running '$service' container (it will be updated in place)"
    return
  fi
  if port_in_use "$port"; then
    owner="$(port_owner "$port")"
    fail "Port $port ($variable) is already in use${owner:+ by $owner}." \
      "Stop the program using it (e.g. a local PostgreSQL, or another app on that port)," \
      "or pick a free port: set $variable=<free port> in .env${extra_hint:+ and $extra_hint}," \
      "then re-run ./setup.sh."
  fi
  ok "Port $port ($variable) is free"
}

check_port "$POSTGRES_PORT" postgres POSTGRES_HOST_PORT ""
check_port "$BACKEND_PORT" backend BACKEND_HOST_PORT "update NEXT_PUBLIC_API_BASE_URL to match"
check_port "$FRONTEND_PORT" frontend FRONTEND_HOST_PORT "add the new origin to CORS_ORIGINS"

# ---------------------------------------------------------------------------------------------
# 4. Build and start
# ---------------------------------------------------------------------------------------------
step "4/5 Building and starting the stack"
info "postgres -> migrate (migrations + demo seed) -> backend -> frontend, each waiting for the previous one"
info "The first build downloads images and dependencies and takes a few minutes; later runs are fast."
info "Full output is also written to $LOG_FILE"

diagnose_failure() {
  local line service state health exit_code
  printf '\n%sService status:%s\n' "$BOLD" "$RESET_STYLE" >&2
  compose ps -a >&2 || true
  while IFS='|' read -r service state health exit_code; do
    [ -n "$service" ] || continue
    if [ "$service" = "migrate" ] && [ "$state" = "exited" ] && [ "$exit_code" = "0" ]; then continue; fi
    if [ "$state" = "running" ] && { [ -z "$health" ] || [ "$health" = "healthy" ]; }; then continue; fi
    printf '\n%sLast log lines of %s (%s%s):%s\n' "$BOLD" "$service" "$state" "${health:+, $health}" "$RESET_STYLE" >&2
    compose logs --no-color --tail 30 "$service" >&2 || true
  done < <(compose ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}' 2>/dev/null || true)
  line="$(tail -n 200 "$LOG_FILE" 2>/dev/null || true)"
  case "$line" in
    *"port is already allocated"* | *"address already in use"*)
      printf '\n  Hint: a port is taken. Change the *_HOST_PORT values in .env and re-run.\n' >&2 ;;
    *"no space left on device"*)
      printf '\n  Hint: Docker is out of disk space. Free some with: docker system prune\n' >&2 ;;
    *"failed to resolve"* | *"TLS handshake"* | *"i/o timeout"* | *"dial tcp"*)
      printf '\n  Hint: images or packages could not be downloaded. Check your internet connection or proxy.\n' >&2 ;;
  esac
}

if ! compose up --build -d --wait --wait-timeout "$WAIT_TIMEOUT_SECONDS" 2>&1 | tee "$LOG_FILE"; then
  diagnose_failure
  fail "The stack did not start successfully (see the service status and logs above)." \
    "Full output: $LOG_FILE" \
    "Inspect a service: docker compose logs <postgres|migrate|backend|frontend>" \
    "Start over with fresh data: ./setup.sh --reset"
fi
ok "All services are up and healthy"

# ---------------------------------------------------------------------------------------------
# 5. Verify, and optional dependencies
# ---------------------------------------------------------------------------------------------
step "5/5 Verifying"

API_BASE="http://localhost:$BACKEND_PORT/api/v1"
WEB_BASE="http://localhost:$FRONTEND_PORT"

wait_for_http() {
  local url="$1" label="$2"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 5 -o /dev/null "$url" 2>/dev/null; then
      ok "$label responds: $url"
      return 0
    fi
    sleep 2
  done
  fail "$label did not respond at $url." \
    "Check the logs: docker compose logs --tail 50 ${3:-backend}" \
    "Check that nothing else is answering on that port, then re-run ./setup.sh."
}

if command -v curl >/dev/null 2>&1; then
  wait_for_http "$API_BASE/health/ready" "API (database connected)" backend
  wait_for_http "$WEB_BASE/" "Web app" frontend
else
  info "Skipped HTTP checks (curl not installed)."
fi

if [ "$INSTALL_DEPS" = true ]; then
  info "Installing backend dependencies (npm ci)..."
  (cd backend && npm ci --no-audit --no-fund) >>"$LOG_FILE" 2>&1 ||
    fail "npm ci failed in backend/." "See $LOG_FILE for the npm output."
  ok "backend/node_modules installed"
  info "Installing frontend dependencies (npm ci)..."
  (cd frontend && npm ci --no-audit --no-fund) >>"$LOG_FILE" 2>&1 ||
    fail "npm ci failed in frontend/." "See $LOG_FILE for the npm output."
  ok "frontend/node_modules installed"
fi

trap - ERR
printf '\n%s%sThe app is running.%s\n\n' "$GREEN" "$BOLD" "$RESET_STYLE"
cat <<EOF
  Rider app            $WEB_BASE
  Driver console       $WEB_BASE/driver   (simulation; open it in a second tab)
  API                  $API_BASE
  API docs (Swagger)   http://localhost:$BACKEND_PORT/docs

  Try it: pick two landmarks at $WEB_BASE, request a ride, then accept, start and
  complete it from the driver console while the rider tab follows along.

  Next steps:
    make logs            follow the container logs
    make seed-reset      delete all rides and restore the demo drivers
    make test-backend    backend unit + integration tests     (needs: ./setup.sh --install-deps)
    make test-frontend   frontend unit + component tests      (needs: ./setup.sh --install-deps)
    make e2e             Playwright end-to-end tests          (needs: ./setup.sh --install-deps)
    make down            stop the stack (keeps the data)
EOF
