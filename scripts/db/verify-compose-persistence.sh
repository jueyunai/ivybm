#!/usr/bin/env bash

set -euo pipefail

project_name="ivybm-persistence-${GITHUB_RUN_ID:-local}-$$"
project_name="$(printf '%s' "$project_name" | tr '[:upper:]_' '[:lower:]-')"
export POSTGRES_DB="ivybm_persistence"
export POSTGRES_PASSWORD="postgres"
export POSTGRES_USER="postgres"

compose=(docker compose -f compose.yaml -p "$project_name")

cleanup() {
  local status=$?

  if ((status != 0)); then
    "${compose[@]}" logs db || true
  fi

  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}

wait_for_database() {
  local attempt
  local consecutive_ready=0

  for attempt in {1..60}; do
    if "${compose[@]}" exec -T db \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc 'SELECT 1' 2>/dev/null | grep -qx '1'; then
      consecutive_ready=$((consecutive_ready + 1))
      if ((consecutive_ready >= 3)); then
        return 0
      fi
    else
      consecutive_ready=0
    fi

    sleep 1
  done

  echo "PostgreSQL did not remain ready for three consecutive checks" >&2
  return 1
}

trap cleanup EXIT

marker="persistence-${GITHUB_RUN_ID:-local}-$$"

"${compose[@]}" up -d db
wait_for_database

data_directory="$(
  "${compose[@]}" exec -T db \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc 'SHOW data_directory'
)"

if [[ "$data_directory" != '/var/lib/postgresql/18/docker' ]]; then
  echo "Unexpected PostgreSQL data directory: $data_directory" >&2
  exit 1
fi

"${compose[@]}" exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE compose_persistence_probe (id integer PRIMARY KEY, marker text NOT NULL); INSERT INTO compose_persistence_probe (id, marker) VALUES (1, '$marker');"

"${compose[@]}" down --remove-orphans
"${compose[@]}" up -d db
wait_for_database

persisted_marker="$(
  "${compose[@]}" exec -T db \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
    'SELECT marker FROM compose_persistence_probe WHERE id = 1'
)"

if [[ "$persisted_marker" != "$marker" ]]; then
  echo "Compose database volume did not preserve the probe row" >&2
  exit 1
fi

echo "Compose database volume preserved data across container recreation"
