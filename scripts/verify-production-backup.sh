#!/usr/bin/env bash

set -euo pipefail

if (($# != 3)); then
  echo "Usage: $0 <production-env-file> <local-backup-dir> <offsite-copy-dir>" >&2
  exit 64
fi

env_file="$1"
local_backup_dir="$2"
offsite_copy_dir="$3"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_script="$script_dir/production-compose.sh"

for path in "$local_backup_dir" "$offsite_copy_dir"; do
  [[ -d "$path" ]] || {
    echo "Backup directory does not exist: $path" >&2
    exit 66
  }
done

local_backup_dir="$(cd "$local_backup_dir" && pwd)"
offsite_copy_dir="$(cd "$offsite_copy_dir" && pwd)"

for directory in "$local_backup_dir" "$offsite_copy_dir"; do
  mode="$(stat -c '%a' "$directory" 2>/dev/null || stat -f '%Lp' "$directory")"
  if [[ "$mode" != '700' ]]; then
    echo "Backup directory must have mode 700: $directory" >&2
    exit 1
  fi
  for file in database.dump media.tar.gz knowledge-sources.tar.gz knowledge-source-assets.tar.gz SHA256SUMS MANIFEST; do
    [[ -f "$directory/$file" ]] || {
      echo "Backup file is missing: $directory/$file" >&2
      exit 1
    }
    file_mode="$(stat -c '%a' "$directory/$file" 2>/dev/null || stat -f '%Lp' "$directory/$file")"
    if [[ "$file_mode" != '600' ]]; then
      echo "Backup file must have mode 600: $directory/$file" >&2
      exit 1
    fi
  done
  (cd "$directory" && sha256sum -c SHA256SUMS >/dev/null)
  for archive in media.tar.gz knowledge-sources.tar.gz knowledge-source-assets.tar.gz; do
    tar -tzf "$directory/$archive" >/dev/null
  done
done

local_device="$(stat -c '%d' "$local_backup_dir" 2>/dev/null || stat -f '%d' "$local_backup_dir")"
offsite_device="$(stat -c '%d' "$offsite_copy_dir" 2>/dev/null || stat -f '%d' "$offsite_copy_dir")"
if [[ "$local_device" == "$offsite_device" ]]; then
  echo 'Offsite backup must be on a different filesystem/device from the production backup' >&2
  exit 1
fi

if ! cmp -s "$local_backup_dir/SHA256SUMS" "$offsite_copy_dir/SHA256SUMS" || \
  ! cmp -s "$local_backup_dir/MANIFEST" "$offsite_copy_dir/MANIFEST"; then
  echo 'Offsite backup does not match the verified production backup manifest' >&2
  exit 1
fi

"$compose_script" "$env_file" exec -T db sh -c 'pg_restore --list >/dev/null' <"$offsite_copy_dir/database.dump"

echo 'Production backup verification passed: checksums, archive readability, permissions, database listing, and offsite device are valid.'
