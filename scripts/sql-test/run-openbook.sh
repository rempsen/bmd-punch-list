#!/usr/bin/env bash
# Open-book billing SQL tests on a scratch database on the local Postgres: user access (0053 on), progress billing
# (0035 and the two functions 0039 replaced), then 0087 twice (it must be safe to run again) and the tests.
set -euo pipefail
cd "$(dirname "$0")"
DB=bmd_openbook_$$
as_pg() { if [ "$(id -un)" = postgres ]; then "$@"; else su postgres -c "$(printf '%q ' "$@")"; fi; }
as_pg psql -X -q -c "DO \$\$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" >/dev/null
as_pg createdb "$DB"
trap 'as_pg dropdb "$DB"; rm -f /tmp/$DB.sql' EXIT
M=$(cd ../../drizzle/migrations && pwd)
MIG=$(find "$M" -maxdepth 1 -name "*.sql" | sort | awk -F/ '{ split($NF, a, "_"); if (a[1] + 0 >= 53 && $NF ~ /(user|admin)/) print }' | tr '\n' ' ')
{
  cat stub.sql seed.sql $MIG openbook.stub.sql "$M/0035_progress_billing.sql"
  awk '/^-- Holdback can be released only from issued bills/ { on = 1 } /^REVOKE ALL ON FUNCTION public.set_sheet_scale/ { on = 0 } on' "$M/0039_review_fixes.sql"
  cat "$M/0087_open_book_jobs.sql" "$M/0087_open_book_jobs.sql" openbook.test.sql
} > /tmp/$DB.sql
chmod 644 /tmp/$DB.sql
as_pg psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f /tmp/$DB.sql 2>&1 | grep -v "NOTICE"
