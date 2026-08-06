#!/usr/bin/env bash

set -euo pipefail

if (($# != 1)); then
  echo "Usage: $0 <base-url>" >&2
  exit 64
fi

base_url="${1%/}"

if [[ ! "$base_url" =~ ^https?:// ]]; then
  echo "Base URL must start with http:// or https://" >&2
  exit 64
fi

smoke_max_attempts="${SMOKE_MAX_ATTEMPTS:-30}"
smoke_retry_delay_seconds="${SMOKE_RETRY_DELAY_SECONDS:-3}"

if [[ ! "$smoke_max_attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo 'SMOKE_MAX_ATTEMPTS must be a positive integer' >&2
  exit 64
fi

if [[ ! "$smoke_retry_delay_seconds" =~ ^[0-9]+$ ]]; then
  echo 'SMOKE_RETRY_DELAY_SECONDS must be a non-negative integer' >&2
  exit 64
fi

smoke_response=''
smoke_http_status=''
smoke_location=''

fetch_response() {
  local path="$1"
  local response_file
  local header_file

  response_file="$(mktemp)"
  header_file="$(mktemp)"

  if ! smoke_http_status="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
    --dump-header "$header_file" --output "$response_file" --write-out '%{http_code}' \
    "$base_url$path")"; then
    smoke_http_status="${smoke_http_status:-000}"
  fi
  smoke_response="$(cat "$response_file")"
  smoke_location="$(grep -i '^location:' "$header_file" | head -n 1 | cut -d: -f2- | \
    sed 's/^[[:space:]]*//; s/\r$//' || true)"
  rm -f "$response_file" "$header_file"
}

fetch_200() {
  local path="$1"
  local attempt

  for ((attempt = 1; attempt <= smoke_max_attempts; attempt++)); do
    fetch_response "$path"

    if [[ "$smoke_http_status" == '200' ]]; then
      return 0
    fi

    if ((attempt < smoke_max_attempts)); then
      sleep "$smoke_retry_delay_seconds"
    fi
  done

  echo "Smoke check failed: $path did not return HTTP 200 (last HTTP status: $smoke_http_status)" >&2
  return 1
}

check_admin_entry() {
  local attempt

  for ((attempt = 1; attempt <= smoke_max_attempts; attempt++)); do
    fetch_response '/admin'

    if [[ "$smoke_http_status" == '200' ]]; then
      echo 'OK /admin (200)'
      return 0
    fi

    if [[ "$smoke_http_status" =~ ^30[12378]$ ]] && \
      [[ "$smoke_location" =~ ^/admin/(login|create-first-user)([?#].*)?$ ]]; then
      echo "OK /admin ($smoke_http_status -> $smoke_location)"
      return 0
    fi

    if ((attempt < smoke_max_attempts)); then
      sleep "$smoke_retry_delay_seconds"
    fi
  done

  echo "Smoke check failed: /admin must return 200 or a safe admin login redirect (last HTTP status: $smoke_http_status, location: ${smoke_location:-<none>})" >&2
  return 1
}

check_json_status() {
  local path="$1"
  local expected_status="$2"

  if ! fetch_200 "$path"; then
    return 1
  fi

  if ! grep -Eq "\\\"status\\\"[[:space:]]*:[[:space:]]*\\\"$expected_status\\\"" <<<"$smoke_response"; then
    echo "Smoke check failed: $path did not report status=$expected_status" >&2
    return 1
  fi

  echo "OK $path"
}

check_page() {
  local path="$1"

  if ! fetch_200 "$path"; then
    return 1
  fi

  echo "OK $path"
}

check_json_status '/api/health/live' 'ok'
check_json_status '/api/health/ready' 'ready'
check_page '/en'
check_page '/ar'
check_page '/dashboard/login'
check_admin_entry
