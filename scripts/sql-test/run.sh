#!/usr/bin/env bash
# Runs the user-admin SQL tests against a scratch database on the local Postgres.
set -euo pipefail
cd "$(dirname "$0")"
DB=bmd_sqltest_$$
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
as_pg() { if [ "$(id -un)" = postgres ]; then "$@"; else su postgres -c "$(printf '%q ' "$@")"; fi; }
as_pg psql -X -q -c "DO \$\$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" >/dev/null
as_pg createdb "$DB"
trap 'as_pg dropdb "$DB"' EXIT
MIGDIR=$(cd ../../drizzle/migrations && pwd)
# The user-access migrations (0053 on) in order. Others need tables the stub doesn't have.
MIG=$(find "$MIGDIR" -maxdepth 1 -name "*.sql" | sort | awk -F/ '{ split($NF, a, "_"); if (a[1] + 0 >= 53 && $NF ~ /(user|staff|admin)/) print }' | tr '\n' ' ')
# The migration uses drizzle's statement-breakpoint comments, which psql ignores.
# Materials: estimate/quote stand-ins, then the materials migrations (0055 material orders and later "material" ones).
MAT=$(find "$MIGDIR" -maxdepth 1 -name "*.sql" | sort | awk -F/ '{ split($NF, a, "_"); if (a[1] + 0 >= 55 && $NF ~ /material/) print }' | tr '\n' ' ')
cat stub.sql seed.sql $MIG user-admin.test.sql materials.stub.sql $MAT materials.test.sql > /tmp/$DB.sql
chmod 644 /tmp/$DB.sql
as_pg "${PSQL[@]}" -d "$DB" -f /tmp/$DB.sql
rm -f /tmp/$DB.sql
