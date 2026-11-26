#!/usr/bin/env bash
set -euo pipefail
ROOT=$(pwd)
PG_TEST_USER=${PG_TEST_USER:-postgres}
TMP=$(mktemp -d /tmp/bmd-broadloom-pg.XXXXXX)
chmod 755 "$TMP"
chown "$PG_TEST_USER" "$TMP"
PG_UID=$(id -u "$PG_TEST_USER")
PG_GID=$(id -g "$PG_TEST_USER")
pg() { setpriv --reuid "$PG_UID" --regid "$PG_GID" --clear-groups "$@"; }
cleanup() { pg pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
pg initdb -D "$TMP/data" -A trust --no-locale >/dev/null
pg pg_ctl -D "$TMP/data" -o "-F -k $TMP -p 55439 -h ''" -l "$TMP/server.log" -w start >/dev/null
cat "$ROOT/scripts/sql-test/broadloom.stub.sql" "$ROOT/drizzle/migrations/0100_broadloom_square_yards.sql" "$ROOT/drizzle/migrations/0100_broadloom_square_yards.sql" "$ROOT/scripts/sql-test/broadloom.test.sql" > "$TMP/tests.sql"
pg psql -h "$TMP" -p 55439 -U "$PG_TEST_USER" -d postgres -X -q -v ON_ERROR_STOP=1 -f "$TMP/tests.sql"