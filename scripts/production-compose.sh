#!/usr/bin/env bash

set -euo pipefail

if (($# < 2)); then
  echo "Usage: $0 <production-env-file> <docker-compose-arguments...>" >&2
  exit 64
fi

env_file="$1"
shift

if [[ ! -r "$env_file" ]]; then
  echo "Production environment file is not readable: $env_file" >&2
  exit 66
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"

if [[ "$env_file" != /* ]]; then
  env_file="$(cd "$(dirname "$env_file")" && pwd)/$(basename "$env_file")"
fi

clean_environment=("PATH=$PATH")

for key in HOME DOCKER_CONFIG DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH XDG_RUNTIME_DIR TMPDIR; do
  if printenv "$key" >/dev/null 2>&1; then
    clean_environment+=("$key=${!key}")
  fi
done

cd "$project_root"
exec env -i "${clean_environment[@]}" docker compose \
  --env-file "$env_file" \
  -f "$project_root/compose.yaml" \
  -f "$project_root/compose.prod.yaml" \
  "$@"
