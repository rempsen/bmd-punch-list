#!/usr/bin/env bash
# Catalogue alias SQL tests on a scratch local Postgres: migration 0096 run twice (idempotent), then the tests.
set -euo pipefail
cd "$(dirname "$0")"
DB=bmd_aliases_$$
as_pg() { if [ "$(id -un)" = postgres ]; then "$@"; else su postgres -c "$(printf '%q ' "$@")"; fi; }
as_pg psql -X -q -c "DO \$\$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" >/dev/null
as_pg createdb "$DB"
trap 'as_pg dropdb "$DB"; rm -f /tmp/$DB.sql' EXIT
M=$(cd ../../drizzle/migrations && pwd)
cat aliases.stub.sql "$M/0096_catalogue_aliases.sql" "$M/0096_catalogue_aliases.sql" aliases.test.sql > /tmp/$DB.sql
chmod 644 /tmp/$DB.sql
as_pg psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f /tmp/$DB.sql
