#!/usr/bin/env bash

set -euo pipefail

if (($# > 1)); then
  echo "Usage: $0 [production-env-file]" >&2
  exit 64
fi

env_file="${1:-.env}"

if [[ ! -r "$env_file" ]]; then
  echo "Production environment file is not readable: $env_file" >&2
  exit 66
fi

read_env_value() {
  local key="$1"
  local line
  local value

  line="$(grep -E "^[[:space:]]*${key}=" "$env_file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    echo "Missing required production variable: $key" >&2
    return 1
  fi

  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ -z "$value" || "$value" == *'REPLACE_'* || "$value" == *'replace-with'* ]]; then
    echo "Production variable is not configured: $key" >&2
    return 1
  fi

  printf '%s' "$value"
}

require_pattern() {
  local key="$1"
  local value="$2"
  local pattern="$3"

  if [[ ! "$value" =~ $pattern ]]; then
    echo "Production variable has an invalid format: $key" >&2
    exit 1
  fi
}

image_tag="$(read_env_value IMAGE_TAG)"
runtime_image="$(read_env_value RUNTIME_IMAGE)"
runtime_digest="$(read_env_value RUNTIME_IMAGE_DIGEST)"
worker_image="$(read_env_value WORKER_IMAGE)"
worker_digest="$(read_env_value WORKER_IMAGE_DIGEST)"
app_version="$(read_env_value APP_VERSION)"
postgres_password="$(read_env_value POSTGRES_PASSWORD)"
database_url="$(read_env_value DATABASE_URL)"
payload_secret="$(read_env_value PAYLOAD_SECRET)"
public_url="$(read_env_value NEXT_PUBLIC_SERVER_URL)"
trust_proxy_headers="$(read_env_value TRUST_PROXY_HEADERS)"

for key in POSTGRES_DB POSTGRES_USER AI_PROVIDER_BASE_URL AI_PROVIDER_API_KEY AI_TEXT_MODEL AI_EMBEDDING_MODEL; do
  read_env_value "$key" >/dev/null
done

require_pattern IMAGE_TAG "$image_tag" '^[0-9a-f]{40}$'
require_pattern RUNTIME_IMAGE "$runtime_image" '^ghcr\.io/[a-z0-9][a-z0-9._/-]*[a-z0-9]$'
require_pattern WORKER_IMAGE "$worker_image" '^ghcr\.io/[a-z0-9][a-z0-9._/-]*[a-z0-9]$'
require_pattern RUNTIME_IMAGE_DIGEST "$runtime_digest" '^sha256:[0-9a-f]{64}$'
require_pattern WORKER_IMAGE_DIGEST "$worker_digest" '^sha256:[0-9a-f]{64}$'

if [[ "$app_version" != "$image_tag" ]]; then
  echo 'APP_VERSION must match IMAGE_TAG for release traceability' >&2
  exit 1
fi

if ((${#postgres_password} < 24)); then
  echo 'POSTGRES_PASSWORD must contain at least 24 characters' >&2
  exit 1
fi

if ((${#payload_secret} < 32)); then
  echo 'PAYLOAD_SECRET must contain at least 32 characters' >&2
  exit 1
fi

if [[ ! "$database_url" =~ ^postgres(ql)?:// || "$database_url" != *'@db:5432/'* ]]; then
  echo 'DATABASE_URL must use a PostgreSQL URL with the Compose db:5432 host' >&2
  exit 1
fi

if [[ "$public_url" != 'https://ivybm.com' ]]; then
  echo 'NEXT_PUBLIC_SERVER_URL must be https://ivybm.com' >&2
  exit 1
fi

if [[ "$trust_proxy_headers" != 'true' ]]; then
  echo 'TRUST_PROXY_HEADERS must be true behind the sole OpenResty ingress' >&2
  exit 1
fi

if grep -Eq '^[[:space:]]*SEED_ADMIN_(EMAIL|PASSWORD)=' "$env_file"; then
  echo 'Production environment must not contain demo seed credentials' >&2
  exit 1
fi

echo 'Production environment preflight passed; no values were printed.'
