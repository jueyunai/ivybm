#!/usr/bin/env bash

set -euo pipefail

replace_unattached="false"
if [[ "${1-}" == "--replace-unattached" ]]; then
  replace_unattached="true"
  shift
fi

if (($# != 3)); then
  echo "Usage: $0 [--replace-unattached] <production-env-file> <stopped-old-app-container> <stopped-old-worker-container>" >&2
  exit 64
fi

env_file="$1"
old_app_container="$2"
old_worker_container="$3"
compose_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/production-compose.sh"
sources_volume="ivybm-prod-knowledge-sources"
assets_volume="ivybm-prod-knowledge-source-assets"

[[ -r "$env_file" ]] || { echo "Production environment file is not readable: $env_file" >&2; exit 66; }
[[ -x "$compose_script" ]] || { echo "Production Compose wrapper is not executable: $compose_script" >&2; exit 66; }
for container in "$old_app_container" "$old_worker_container"; do
  docker inspect "$container" >/dev/null 2>&1 || {
    echo "Old container not found: $container" >&2
    exit 66
  }
  running="$(docker inspect -f '{{.State.Running}}' "$container")"
  [[ "$running" == "false" ]] || {
    echo "Stop the old container before exporting knowledge files: $container" >&2
    exit 1
  }
done

existing_volumes=()
for volume in "$sources_volume" "$assets_volume"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    existing_volumes+=("$volume")
  fi
done
if ((${#existing_volumes[@]})) && [[ "$replace_unattached" != "true" ]]; then
  echo "Refusing to overwrite existing volume: ${existing_volumes[0]}" >&2
  exit 1
fi

if ((${#existing_volumes[@]})); then
  for volume in "${existing_volumes[@]}"; do
    attached_containers="$(docker ps -aq --filter "volume=$volume")"
    [[ -z "$attached_containers" ]] || {
      echo "Refusing to replace volume referenced by a container: $volume" >&2
      exit 1
    }
  done
fi

temporary_dir="$(mktemp -d)"
unique_suffix="$$-${RANDOM}"
stage_sources_volume="${sources_volume}-stage-${unique_suffix}"
stage_assets_volume="${assets_volume}-stage-${unique_suffix}"
staging_volumes=()
backup_sources_volume="${sources_volume}-backup-${unique_suffix}"
backup_assets_volume="${assets_volume}-backup-${unique_suffix}"
backup_volumes=()
switching_started="false"
migration_complete="false"

copy_volume_to_volume() {
  local source_volume="$1" target_volume="$2"
  docker run --rm -u 0 -v "$target_volume:/target" -v "$source_volume:/source:ro" alpine:3.22 \
    sh -c 'set -eu; cp -a /source/. /target/; chown -R 1001:1001 /target; find /target -type f -print -quit >/dev/null'
}

restore_existing_volumes() {
  local volume backup was_existing
  for volume in "$sources_volume" "$assets_volume"; do
    was_existing="false"
    if ((${#existing_volumes[@]})); then
      for existing_volume in "${existing_volumes[@]}"; do
        [[ "$existing_volume" == "$volume" ]] && was_existing="true"
      done
    fi
    if [[ "$was_existing" != "true" ]]; then
      docker volume rm "$volume" >/dev/null 2>&1 || true
    fi
  done
  if ((${#existing_volumes[@]})); then
    for volume in "${existing_volumes[@]}"; do
      case "$volume" in
        "$sources_volume") backup="$backup_sources_volume" ;;
        "$assets_volume") backup="$backup_assets_volume" ;;
        *) echo "Warning: no backup volume mapped for $volume" >&2; return 1 ;;
      esac
      docker volume rm "$volume" >/dev/null 2>&1 || true
      docker volume create "$volume" >/dev/null || return 1
      copy_volume_to_volume "$backup" "$volume" || return 1
    done
  fi
}

cleanup() {
  local status=$?
  trap - EXIT

  if [[ "$migration_complete" != "true" ]]; then
    if [[ "$switching_started" == "true" ]]; then
      if restore_existing_volumes; then
        echo "Migration switch failed; existing volumes were restored from backup." >&2
        echo "Retained recovery backups (remove only after verification):" >&2
        if ((${#backup_volumes[@]})); then
          for volume in "${backup_volumes[@]}"; do
            echo "  - $volume" >&2
          done
        fi
        if ((${#staging_volumes[@]})); then
          for volume in "${staging_volumes[@]}"; do
            docker volume rm "$volume" >/dev/null 2>&1 ||
              echo "Warning: failed to remove incomplete staging volume: $volume" >&2
          done
        fi
      else
        echo "Warning: volume switching failed and automatic restoration failed." >&2
        echo "Staging and backup volumes have been preserved for manual recovery:" >&2
        if ((${#staging_volumes[@]})); then
          for volume in "${staging_volumes[@]}"; do
            echo "  - $volume" >&2
          done
        fi
        if ((${#backup_volumes[@]})); then
          for volume in "${backup_volumes[@]}"; do
            echo "  - $volume" >&2
          done
        fi
      fi
    else
      if ((${#staging_volumes[@]})); then
        for volume in "${staging_volumes[@]}"; do
          docker volume rm "$volume" >/dev/null 2>&1 ||
            echo "Warning: failed to remove incomplete staging volume: $volume" >&2
        done
      fi
      if ((${#backup_volumes[@]})); then
        for volume in "${backup_volumes[@]}"; do
          docker volume rm "$volume" >/dev/null 2>&1 ||
            echo "Warning: failed to remove incomplete backup volume: $volume" >&2
        done
      fi
    fi
  fi

  if [[ "$migration_complete" == "true" ]]; then
    if ((${#backup_volumes[@]})); then
      for volume in "${backup_volumes[@]}"; do
        docker volume rm "$volume" >/dev/null 2>&1 ||
          echo "Warning: failed to remove migration backup volume: $volume" >&2
      done
    fi
  fi

  rm -rf -- "$temporary_dir"
  exit "$status"
}
trap cleanup EXIT
mkdir "$temporary_dir/sources" "$temporary_dir/assets"

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

export_legacy_sources() {
  if docker cp "$old_app_container:/app/private/knowledge-sources/." "$temporary_dir/sources/" 2>/dev/null; then
    return 0
  fi

  if [[ ! -s "$temporary_dir/expected-sources" ]]; then
    echo "Legacy knowledge sources directory is missing from $old_app_container, and database manifest is empty; proceeding with empty directory."
    return 0
  fi

  echo "Failed to export legacy knowledge sources directory from $old_app_container:/app/private/knowledge-sources while database manifest is not empty" >&2
  return 1
}

export_legacy_assets() {
  if docker cp "$old_worker_container:/app/private/knowledge-source-assets/." "$temporary_dir/assets/" 2>/dev/null; then
    return 0
  fi

  if [[ ! -s "$temporary_dir/expected-assets" ]]; then
    echo "Legacy knowledge source assets directory is missing from $old_worker_container, and database manifest is empty; proceeding with empty directory."
    return 0
  fi

  echo "Failed to export legacy knowledge source assets directory from $old_worker_container:/app/private/knowledge-source-assets while database manifest is not empty" >&2
  return 1
}

export_legacy_sources
export_legacy_assets

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

docker volume create "$stage_sources_volume" >/dev/null
staging_volumes+=("$stage_sources_volume")
docker volume create "$stage_assets_volume" >/dev/null
staging_volumes+=("$stage_assets_volume")

copy_into_volume() {
  local volume="$1" source="$2"
  docker run --rm -u 0 -v "$volume:/target" -v "$source:/source:ro" alpine:3.22 \
    sh -c 'set -eu; cp -a /source/. /target/; chown -R 1001:1001 /target; find /target -type f -print -quit >/dev/null'
}
copy_into_volume "$stage_sources_volume" "$temporary_dir/sources"
copy_into_volume "$stage_assets_volume" "$temporary_dir/assets"

verify_volume() {
  local volume="$1" expected_file="$2"
  docker run --rm -v "$volume:/target:ro" -v "$expected_file:/expected:ro" alpine:3.22 \
    sh -c 'set -eu; while IFS= read -r filename; do [ -z "$filename" ] || test -f "/target/$filename"; done < /expected; test "$(stat -c %u:%g /target)" = 1001:1001; test -z "$(find /target -mindepth 1 \( ! -user 1001 -o ! -group 1001 \) -print -quit)"'
}
verify_volume "$stage_sources_volume" "$temporary_dir/expected-sources"
verify_volume "$stage_assets_volume" "$temporary_dir/expected-assets"

if ((${#existing_volumes[@]})); then
  if [[ " ${existing_volumes[*]} " == *" $sources_volume "* ]]; then
    docker volume create "$backup_sources_volume" >/dev/null
    backup_volumes+=("$backup_sources_volume")
    copy_volume_to_volume "$sources_volume" "$backup_sources_volume"
  fi
  if [[ " ${existing_volumes[*]} " == *" $assets_volume "* ]]; then
    docker volume create "$backup_assets_volume" >/dev/null
    backup_volumes+=("$backup_assets_volume")
    copy_volume_to_volume "$assets_volume" "$backup_assets_volume"
  fi
fi

switching_started="true"

if ((${#existing_volumes[@]})); then
  for volume in "${existing_volumes[@]}"; do
    attached_containers="$(docker ps -aq --filter "volume=$volume")"
    [[ -z "$attached_containers" ]] || {
      echo "Refusing to replace volume referenced by a container: $volume" >&2
      exit 1
    }
  done
  for volume in "${existing_volumes[@]}"; do
    docker volume rm "$volume" >/dev/null
  done
fi

docker volume create "$sources_volume" >/dev/null
docker volume create "$assets_volume" >/dev/null

copy_volume_to_volume "$stage_sources_volume" "$sources_volume"
copy_volume_to_volume "$stage_assets_volume" "$assets_volume"

verify_volume "$sources_volume" "$temporary_dir/expected-sources"
verify_volume "$assets_volume" "$temporary_dir/expected-assets"

migration_complete="true"
docker volume rm "$stage_sources_volume" "$stage_assets_volume" >/dev/null 2>&1 || true

echo "Migrated and verified database-referenced knowledge files into $sources_volume and $assets_volume"
