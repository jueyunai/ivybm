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
cleanup() { rm -rf -- "$temporary_dir"; }
trap cleanup EXIT
mkdir "$temporary_dir/sources" "$temporary_dir/assets"

docker cp "$old_app_container:/app/private/knowledge-sources/." "$temporary_dir/sources/"
docker cp "$old_app_container:/app/private/knowledge-source-assets/." "$temporary_dir/assets/"

# The database is the source of truth for every file that must survive migration.
"$compose_script" "$env_file" exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT filename FROM knowledge_source_documents WHERE filename IS NOT NULL"' \
  >"$temporary_dir/expected-sources"
"$compose_script" "$env_file" exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT filename FROM knowledge_source_assets WHERE filename IS NOT NULL"' \
  >"$temporary_dir/expected-assets"

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
docker volume create "$assets_volume" >/dev/null
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
    sh -c 'set -eu; while IFS= read -r filename; do [ -z "$filename" ] || test -f "/target/$filename"; done < /expected'
}
verify_volume "$sources_volume" "$temporary_dir/expected-sources"
verify_volume "$assets_volume" "$temporary_dir/expected-assets"

echo "Migrated and verified database-referenced knowledge files into $sources_volume and $assets_volume"
