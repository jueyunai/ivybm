#!/usr/bin/env bash

set -euo pipefail

if (($# != 1)); then
  echo "Usage: $0 <offsite-backup-dir>" >&2
  exit 64
fi

backup_dir="$1"
restore_image='pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0'
container_name="ivybm-backup-restore-$RANDOM-$$"

[[ -d "$backup_dir" ]] || {
  echo "Backup directory does not exist: $backup_dir" >&2
  exit 66
}
backup_dir="$(cd "$backup_dir" && pwd)"
[[ -r "$backup_dir/database.dump" && -r "$backup_dir/media.tar.gz" ]] || {
  echo 'Backup directory must contain database.dump and media.tar.gz' >&2
  exit 1
}

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --name "$container_name" \
  --tmpfs /var/lib/postgresql \
  -e POSTGRES_DB=ivybm_restore \
  -e POSTGRES_PASSWORD=restore-only-password \
  -e POSTGRES_USER=restore \
  "$restore_image" >/dev/null

for attempt in {1..30}; do
  if docker exec "$container_name" pg_isready -U restore -d ivybm_restore >/dev/null 2>&1; then
    break
  fi
  if ((attempt == 30)); then
    echo 'Temporary restore database did not become ready' >&2
    exit 1
  fi
  sleep 2
done

docker exec -i "$container_name" pg_restore \
  --exit-on-error --no-owner --no-privileges \
  -U restore -d ivybm_restore <"$backup_dir/database.dump"

docker run --rm \
  -v "$backup_dir/media.tar.gz:/backup/media.tar.gz:ro" \
  alpine:3.22 tar -tzf /backup/media.tar.gz >/dev/null

echo 'Production backup restore rehearsal passed in an isolated temporary database and media archive reader.'
