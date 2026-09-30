#!/usr/bin/env sh
set -eu

FIAA_TEST_PG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fiaa-postgres.XXXXXX")
FIAA_TEST_PG_PORT=${FIAA_TEST_PG_PORT:-55432}
FIAA_TEST_PG_USER=$(id -un)

cleanup() {
  if test -f "$FIAA_TEST_PG_DIR/postmaster.pid"; then
    pg_ctl -D "$FIAA_TEST_PG_DIR" -m fast stop >/dev/null 2>&1 || true
  fi
  find "$FIAA_TEST_PG_DIR" -depth -delete
}
trap cleanup EXIT INT TERM

if pg_isready -h "$FIAA_TEST_PG_DIR" -p "$FIAA_TEST_PG_PORT" -q; then
  echo "Refusing to use an occupied temporary PostgreSQL socket/port." >&2
  exit 1
fi

initdb -D "$FIAA_TEST_PG_DIR" --auth=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$FIAA_TEST_PG_DIR" -l "$FIAA_TEST_PG_DIR/postgres.log" -o "-F -k '$FIAA_TEST_PG_DIR' -p $FIAA_TEST_PG_PORT" start >/dev/null
createdb -h "$FIAA_TEST_PG_DIR" -p "$FIAA_TEST_PG_PORT" -U "$FIAA_TEST_PG_USER" fiaa_test

DATABASE_URL="host=$FIAA_TEST_PG_DIR port=$FIAA_TEST_PG_PORT dbname=fiaa_test user=$FIAA_TEST_PG_USER" \
  sh scripts/test-database.sh
