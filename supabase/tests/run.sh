#!/usr/bin/env bash
# Crea una BD limpia, aplica migraciones y corre las pruebas.
# Uso: PGHOST=/tmp PGPORT=5433 PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-hub_test}
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -f tests/_supabase_shim.sql
for f in migrations/*.sql; do $P -d $DB -f "$f" > /dev/null; done
$P -d $DB -f tests/db_tests.sql | grep -E "PASARON|skipped" || true
# Borrado de demo en una BD limpia
$P -d postgres -c "drop database if exists ${DB}_purge" -c "create database ${DB}_purge"
$P -d ${DB}_purge -f tests/_supabase_shim.sql
for f in migrations/*.sql; do $P -d ${DB}_purge -f "$f" > /dev/null; done
$P -d ${DB}_purge -f tests/purge_test.sql | grep -E "PURGE OK|skipped|purged" -A0 || true
