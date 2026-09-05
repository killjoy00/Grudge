#!/usr/bin/env bash
# Run the RLS attack suite against a throwaway local Postgres.
#
# The schema under test is extracted straight out of docs/SCHEMA_PROPOSAL.md, so
# the document and the thing being tested cannot drift apart. Once the proposal
# is approved and split into supabase/migrations/, point SCHEMA_SRC at those
# files instead.
#
#   ./tests/rls/run.sh
#
# Requires: postgresql (initdb, pg_ctl, psql), python3.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT:-5433}"
WORKDIR="$(mktemp -d)"
SOCKET="$WORKDIR/sock"

cleanup() {
  "$PGBIN/pg_ctl" -D "$WORKDIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

mkdir -p "$WORKDIR/data" "$SOCKET"
# initdb refuses to run as root; drop to the postgres user when necessary.
if [ "$(id -u)" -eq 0 ]; then
  chown -R postgres "$WORKDIR"; chmod 700 "$WORKDIR/data"
  RUN="su postgres -c"
else
  RUN="bash -c"
fi

echo "==> starting throwaway postgres on port $PORT"
$RUN "$PGBIN/initdb -D $WORKDIR/data -A trust -U postgres" >/dev/null
$RUN "$PGBIN/pg_ctl -D $WORKDIR/data -l $WORKDIR/pg.log \
      -o '-k $SOCKET -p $PORT -c listen_addresses=' -w start" >/dev/null

PSQL="psql -h $SOCKET -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

echo "==> extracting schema from docs/SCHEMA_PROPOSAL.md"
python3 - "$ROOT" "$WORKDIR" <<'PY'
import re, sys, pathlib
root, work = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
md = (root / 'docs' / 'SCHEMA_PROPOSAL.md').read_text()
blocks = re.findall(r'```sql\n(.*?)```', md, re.S)
sql = '\n\n'.join(blocks)
# The two CREATE ROLE lines carry placeholder passwords meant for the real
# deployment; the test stub creates these roles itself, without passwords.
import re as _re
sql = _re.sub(r"create role app_pipeline[^;]*;", "", sql)
sql = _re.sub(r"create role app_user[^;]*;", "", sql)
(work / 'schema.sql').write_text(sql)
print(f"    {len(blocks)} SQL blocks, {sum(b.count(chr(10)) for b in blocks)} lines")
PY

echo "==> applying supabase stub"
$PSQL -f "$ROOT/tests/rls/00-stub.sql"
echo "==> applying schema"
$PSQL -f "$WORKDIR/schema.sql"
echo "==> applying grants + fixtures"
$PSQL -f "$ROOT/tests/rls/01-grants-and-fixtures.sql"
# Every migration, in date order. This used to name one file, which meant each
# new migration silently fell outside the security suite -- the tables it added
# did not exist here, so no policy on them could ever be tested. The glob sorts
# lexicographically and the filenames are ISO dates, so order is the order they
# were applied in production.
echo "==> applying migrations"
for migration in "$ROOT"/scripts/migrations/*.sql; do
  echo "    $(basename "$migration")"
  $PSQL -f "$migration"
done
echo "==> applying and validating provisioner role grants"
$PSQL -f "$ROOT/scripts/provisioner-role.sql"
echo "==> running attacks"
# ON_ERROR_STOP is essential here, not cosmetic: without it psql exits 0 even
# when the summary block raises, and a failing security suite reports green.
psql -h "$SOCKET" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 \
     -f "$ROOT/tests/rls/02-attacks.sql"

echo "==> running current-week prediction regression"
psql -h "$SOCKET" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 \
     -f "$ROOT/tests/rls/03-current-prediction-week.sql"
