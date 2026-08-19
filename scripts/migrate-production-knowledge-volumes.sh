#!/usr/bin/env bash

set -euo pipefail

if (($# != 2)); then
  echo "Usage: $0 <production-env-file> <stopped-old-app-container>" >&2
  exit 64
fi

env_file="$1"
old_app_container="$2"
compose_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/production-compose.sh"
sources_volume='ivybm-prod-knowledge-sources'
assets_volume='ivybm-prod-knowledge-source-assets'

[[ -r "$env_file" ]] || { echo "Production environment file is not readable: $env_file" >&2; exit 66; }
[[ -x "$compose_script" ]] || { echo "Production Compose wrapper is not executable: $compose_script" >&2; exit 66; }
docker inspect "$old_app_container" >/dev/null 2>&1 || { echo "Old app container not found: $old_app_container" >&2; exit 66; }

running="$(docker inspect -f '{{.State.Running}}' "$old_app_container")"
[[ "$running" == 'false' ]] || { echo 'Stop the old app container before exporting knowledge files.' >&2; exit 1; }

for volume in "$sources_volume" "$assets_volume"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "Refusing to overwrite existing volume: $volume" >&2
    exit 1
  fi
done

temporary_dir="$(mktemp -d)"
created_volumes=()
migration_complete='false'
cleanup() {
  local status=$?
  trap - EXIT

  if [[ "$migration_complete" != 'true' ]]; then
    for volume in "${created_volumes[@]}"; do
      docker volume rm "$volume" >/dev/null 2>&1 ||
        echo "Warning: failed to remove incomplete migration volume: $volume" >&2
    done
  fi

  rm -rf -- "$temporary_dir"
  exit "$status"
}
trap cleanup EXIT
mkdir "$temporary_dir/sources" "$temporary_dir/assets"

docker cp "$old_app_container:/app/private/knowledge-sources/." "$temporary_dir/sources/"
docker cp "$old_app_container:/app/private/knowledge-source-assets/." "$temporary_dir/assets/"

# The database is the source of truth for every file that must survive migration. Encode each
# filename so control characters cannot corrupt the line-oriented manifest before validation.
query_expected() {
  local table="$1" encoded_file="$2" expected_file="$3" decoded_file="$temporary_dir/decoded"
  local sql="SELECT replace(encode(convert_to(filename, 'UTF8'), 'base64'), E'\\n', '') FROM $table WHERE filename IS NOT NULL"

  "$compose_script" "$env_file" exec -T db sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"' sh "$sql" >"$encoded_file"

  : >"$expected_file"
  while IFS= read -r encoded; do
    [[ -n "$encoded" ]] || {
      echo "Unsafe empty filename returned by $table" >&2
      return 1
    }
    printf '%s' "$encoded" | base64 --decode >"$decoded_file" 2>/dev/null || {
      echo "Invalid encoded filename returned by $table" >&2
      return 1
    }
    if [[ ! -s "$decoded_file" ]] || LC_ALL=C grep -q '[[:cntrl:]]' "$decoded_file"; then
      echo "Unsafe filename returned by $table" >&2
      return 1
    fi
    local filename
    filename="$(cat "$decoded_file")"
    if [[ "$filename" == '.' || "$filename" == '..' || "$filename" == */* ]]; then
      echo "Unsafe filename returned by $table" >&2
      return 1
    fi
    printf '%s\n' "$filename" >>"$expected_file"
  done <"$encoded_file"
}
query_expected knowledge_source_documents "$temporary_dir/expected-sources.encoded" "$temporary_dir/expected-sources"
query_expected knowledge_source_assets "$temporary_dir/expected-assets.encoded" "$temporary_dir/expected-assets"

verify_expected() {
  local expected_file="$1" root="$2"
  while IFS= read -r filename; do
    [[ -n "$filename" && -f "$root/$filename" ]] || {
      echo "Database-referenced file is missing from export: $root/$filename" >&2
      return 1
    }
  done <"$expected_file"
}
verify_expected "$temporary_dir/expected-sources" "$temporary_dir/sources"
verify_expected "$temporary_dir/expected-assets" "$temporary_dir/assets"

docker volume create "$sources_volume" >/dev/null
created_volumes+=("$sources_volume")
docker volume create "$assets_volume" >/dev/null
created_volumes+=("$assets_volume")
copy_into_volume() {
  local volume="$1" source="$2"
  docker run --rm -u 0 -v "$volume:/target" -v "$source:/source:ro" alpine:3.22 \
    sh -c 'set -eu; cp -a /source/. /target/; chown -R 1001:1001 /target; find /target -type f -print -quit >/dev/null'
}
copy_into_volume "$sources_volume" "$temporary_dir/sources"
copy_into_volume "$assets_volume" "$temporary_dir/assets"

verify_volume() {
  local volume="$1" expected_file="$2"
  docker run --rm -v "$volume:/target:ro" -v "$expected_file:/expected:ro" alpine:3.22 \
    sh -c 'set -eu; while IFS= read -r filename; do [ -z "$filename" ] || test -f "/target/$filename"; done < /expected; test "$(stat -c %u:%g /target)" = 1001:1001; test -z "$(find /target -mindepth 1 \( ! -user 1001 -o ! -group 1001 \) -print -quit)"'
}
verify_volume "$sources_volume" "$temporary_dir/expected-sources"
verify_volume "$assets_volume" "$temporary_dir/expected-assets"

migration_complete='true'
echo "Migrated and verified database-referenced knowledge files into $sources_volume and $assets_volume"
