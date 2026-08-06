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

fetch_200() {
  local path="$1"
  local attempt
  local response_file

  for ((attempt = 1; attempt <= smoke_max_attempts; attempt++)); do
    response_file="$(mktemp)"

    if ! smoke_http_status="$(curl --silent --show-error --connect-timeout 5 --max-time 15 --output "$response_file" --write-out '%{http_code}' "$base_url$path")"; then
      smoke_http_status="${smoke_http_status:-000}"
    fi
    smoke_response="$(cat "$response_file")"
    rm -f "$response_file"

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
check_page '/admin'
