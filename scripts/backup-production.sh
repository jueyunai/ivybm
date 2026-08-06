#!/usr/bin/env bash

set -euo pipefail

if (($# < 1 || $# > 2)); then
  echo "Usage: $0 <production-env-file> [backup-root]" >&2
  exit 64
fi

env_file="$1"
backup_root="${2:-/opt/ivybm/.release-backups}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_script="$script_dir/production-compose.sh"

if [[ ! -r "$env_file" ]]; then
  echo "Production environment file is not readable: $env_file" >&2
  exit 66
fi

if [[ ! -x "$compose_script" ]]; then
  echo "Production Compose wrapper is not executable: $compose_script" >&2
  exit 66
fi

running_services="$("$compose_script" "$env_file" ps --services --status running)"
if grep -Eq '^(app|worker)$' <<<"$running_services"; then
  echo 'Stop app and worker before creating a production backup; the database must be quiescent.' >&2
  exit 1
fi

umask 077
mkdir -p "$backup_root"
chmod 700 "$backup_root"
backup_dir="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)-pre-release"
if [[ -e "$backup_dir" ]]; then
  echo "Refusing to overwrite an existing production backup: $backup_dir" >&2
  exit 1
fi
temporary_dir="$(mktemp -d "$backup_root/.pre-release.XXXXXX")"

cleanup() {
  if [[ -n "$temporary_dir" && -d "$temporary_dir" ]]; then
    rm -rf -- "$temporary_dir"
  fi
}
trap cleanup EXIT

chmod 700 "$temporary_dir"

"$compose_script" "$env_file" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$temporary_dir/database.dump"
[[ -s "$temporary_dir/database.dump" ]] || {
  echo 'Database dump is empty' >&2
  exit 1
}

"$compose_script" "$env_file" exec -T db sh -c 'pg_restore --list >/dev/null' <"$temporary_dir/database.dump"

docker run --rm \
  -v ivybm-prod-media:/media:ro \
  -v "$temporary_dir:/backup" \
  alpine:3.22 \
  sh -c 'set -eu; tar -czf /backup/media.tar.gz.tmp -C /media .; tar -tzf /backup/media.tar.gz.tmp >/dev/null; mv /backup/media.tar.gz.tmp /backup/media.tar.gz'
[[ -s "$temporary_dir/media.tar.gz" ]] || {
  echo 'Media archive is empty' >&2
  exit 1
}

(
  cd "$temporary_dir"
  sha256sum database.dump media.tar.gz >SHA256SUMS
  sha256sum -c SHA256SUMS >/dev/null
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >MANIFEST
  printf 'database_dump=database.dump\nmedia_archive=media.tar.gz\n' >>MANIFEST
)

mv "$temporary_dir" "$backup_dir"
temporary_dir=''
chmod 700 "$backup_dir"
chmod 600 "$backup_dir"/*

printf '%s\n' "$backup_dir"
