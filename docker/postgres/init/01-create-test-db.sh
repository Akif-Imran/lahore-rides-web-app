#!/bin/sh
# Creates the integration-test database next to the main one.
# The Postgres entrypoint runs this only on first initialisation of the data volume
# (`make reset` / `docker compose down -v` to re-run it).
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE DATABASE "${POSTGRES_DB}_test" OWNER "$POSTGRES_USER";
EOSQL
