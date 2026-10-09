#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "usage: $0 <custom-format-dump>" >&2
  exit 64
fi

if ! command -v docker >/dev/null; then
  echo "docker is required for the local restore check" >&2
  exit 69
fi

dump_path="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
container_name="orma-restore-check-$$"

cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --rm --network none --name "$container_name" \
  --env POSTGRES_PASSWORD=restore-check \
  postgres:17 >/dev/null

for _ in {1..30}; do
  if docker exec "$container_name" pg_isready --username postgres --dbname postgres >/dev/null; then
    break
  fi
  sleep 1
done

docker exec "$container_name" pg_isready --username postgres --dbname postgres >/dev/null
docker exec "$container_name" psql --username postgres --dbname postgres \
  --command 'create extension if not exists pgcrypto' >/dev/null
docker cp "$dump_path" "$container_name:/tmp/restore.dump"
docker exec "$container_name" pg_restore --exit-on-error --clean --if-exists \
  --username postgres --dbname postgres --no-owner --no-privileges /tmp/restore.dump

docker exec "$container_name" psql --tuples-only --no-align --field-separator $'\t' \
  --username postgres --dbname postgres <<'SQL'
select format(
  'select %L as table_name, count(*) as row_count from %I.%I;',
  table_schema || '.' || table_name,
  table_schema,
  table_name
)
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name
\gexec
SQL
