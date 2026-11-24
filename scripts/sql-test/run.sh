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
MIG=$(cd ../../drizzle/migrations && pwd)/0053_user_admin.sql
# The migration uses drizzle's statement-breakpoint comments, which psql ignores.
cat stub.sql seed.sql "$MIG" user-admin.test.sql > /tmp/$DB.sql
chmod 644 /tmp/$DB.sql
as_pg "${PSQL[@]}" -d "$DB" -f /tmp/$DB.sql
rm -f /tmp/$DB.sql
