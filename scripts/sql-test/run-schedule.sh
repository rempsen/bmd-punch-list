#!/usr/bin/env bash
# Runs the scheduling SQL tests (migration 0083: runs, workdays, tentative, report-to, crew confirmation) on the local Postgres.
set -euo pipefail
cd "$(dirname "$0")"
DB=bmd_sqltest_sched_$$
as_pg() { if [ "$(id -un)" = postgres ]; then "$@"; else su postgres -c "$(printf '%q ' "$@")"; fi; }
as_pg psql -X -q -c "DO \$\$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" >/dev/null
as_pg createdb "$DB"
trap 'as_pg dropdb "$DB"; rm -f /tmp/$DB.sql' EXIT
MIG=../../drizzle/migrations/0083_schedule_runs_and_confirmation.sql
# The migration twice, to prove it is safe to run again.
cat schedule.stub.sql "$MIG" "$MIG" schedule.test.sql > /tmp/$DB.sql
chmod 644 /tmp/$DB.sql
as_pg psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f /tmp/$DB.sql
