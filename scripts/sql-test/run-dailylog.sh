#!/usr/bin/env bash
# Runs the daily log / requests / crew lists SQL tests (migration 0084) against a scratch database on the local Postgres.
# Stands on the same stub, seed and user-access migrations as run.sh, then adds what 0084 reads.
set -euo pipefail
cd "$(dirname "$0")"
DB=bmd_dailylog_$$
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
as_pg() { if [ "$(id -un)" = postgres ]; then "$@"; else su postgres -c "$(printf '%q ' "$@")"; fi; }
as_pg psql -X -q -c "DO \$\$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$; DO \$\$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" >/dev/null
as_pg createdb "$DB"
trap 'as_pg dropdb "$DB"' EXIT
MIGDIR=$(cd ../../drizzle/migrations && pwd)
MIG=$(find "$MIGDIR" -maxdepth 1 -name "*.sql" | sort | awk -F/ '{ split($NF, a, "_"); if (a[1] + 0 >= 53 && a[1] + 0 <= 58 && $NF ~ /(user|staff|admin)/) print }' | tr '\n' ' ')
# The migration twice: it must be safe to run again.
cat stub.sql seed.sql $MIG dailylog.stub.sql "$MIGDIR"/0084_daily_logs_and_requests.sql "$MIGDIR"/0084_daily_logs_and_requests.sql dailylog.test.sql > /tmp/$DB.sql
chmod 644 /tmp/$DB.sql
as_pg "${PSQL[@]}" -d "$DB" -f /tmp/$DB.sql 2>&1 | grep -v "NOTICE"
rm -f /tmp/$DB.sql
