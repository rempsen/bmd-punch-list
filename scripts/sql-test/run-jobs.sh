#!/usr/bin/env bash
# Runs the job list / job details SQL tests (migration 0082) against a scratch database on the local Postgres.
# Kept apart from run.sh because it needs its own stand-in for projects, stages and contacts.
# The migration is applied twice to prove it is safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
DB=bmd_sqltest_jobs_$$
as_pg() { if [ "$(id -un)" = postgres ]; then "$@"; else su postgres -c "$(printf '%q ' "$@")"; fi; }
as_pg psql -X -q -c "DO \$\$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" >/dev/null
as_pg createdb "$DB"
trap 'as_pg dropdb "$DB"' EXIT
MIG=../../drizzle/migrations/0082_job_list_and_details.sql
cat jobs.stub.sql "$MIG" "$MIG" jobs.test.sql > /tmp/$DB.sql
chmod 644 /tmp/$DB.sql
as_pg psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f /tmp/$DB.sql
rm -f /tmp/$DB.sql
