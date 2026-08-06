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

read_optional_env_value() {
  local key="$1"
  local line
  local value

  line="$(grep -E "^[[:space:]]*${key}=" "$env_file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi

  value="${line#*=}"
  value="${value%$'\r'}"
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
ai_configuration_encryption_key="$(read_env_value AI_CONFIG_ENCRYPTION_KEY)"
platform_credential_encryption_key="$(read_optional_env_value PLATFORM_CREDENTIAL_ENCRYPTION_KEY)"
reasoning_enabled="$(read_optional_env_value AI_REASONING_ENABLED)"
reasoning_effort="$(read_optional_env_value AI_REASONING_EFFORT)"
ai_provider_base_url="$(read_optional_env_value AI_PROVIDER_BASE_URL)"
ai_provider_api_key="$(read_optional_env_value AI_PROVIDER_API_KEY)"
ai_text_model="$(read_optional_env_value AI_TEXT_MODEL)"
ai_embedding_model="$(read_optional_env_value AI_EMBEDDING_MODEL)"
ai_embedding_dimensions="$(read_optional_env_value AI_EMBEDDING_DIMENSIONS)"
meta_webhook_app_secret="$(read_optional_env_value META_WEBHOOK_APP_SECRET)"
meta_webhook_verify_token="$(read_optional_env_value META_WEBHOOK_VERIFY_TOKEN)"
meta_webhook_allowed_account_ids="$(read_optional_env_value META_WEBHOOK_ALLOWED_ACCOUNT_IDS)"
meta_app_id="$(read_optional_env_value META_APP_ID)"
meta_login_config_id="$(read_optional_env_value META_LOGIN_CONFIG_ID)"
meta_oauth_redirect_uri="$(read_optional_env_value META_OAUTH_REDIRECT_URI)"
instagram_app_id="$(read_optional_env_value INSTAGRAM_APP_ID)"
instagram_app_secret="$(read_optional_env_value INSTAGRAM_APP_SECRET)"
instagram_oauth_redirect_uri="$(read_optional_env_value INSTAGRAM_OAUTH_REDIRECT_URI)"
feishu_qr_registration_enabled="$(read_env_value FEISHU_QR_REGISTRATION_ENABLED)"
feishu_oauth_redirect_uri="$(read_optional_env_value FEISHU_OAUTH_REDIRECT_URI)"
feishu_credential_encryption_key="$(read_optional_env_value FEISHU_CREDENTIAL_ENCRYPTION_KEY)"

for key in POSTGRES_DB POSTGRES_USER; do
  read_env_value "$key" >/dev/null
done

require_pattern IMAGE_TAG "$image_tag" '^[0-9a-f]{40}$'
require_pattern RUNTIME_IMAGE "$runtime_image" '^ghcr\.io/[a-z0-9][a-z0-9._/-]*[a-z0-9]$'
require_pattern WORKER_IMAGE "$worker_image" '^ghcr\.io/[a-z0-9][a-z0-9._/-]*[a-z0-9]$'
require_pattern RUNTIME_IMAGE_DIGEST "$runtime_digest" '^sha256:[0-9a-f]{64}$'
require_pattern WORKER_IMAGE_DIGEST "$worker_digest" '^sha256:[0-9a-f]{64}$'
require_pattern AI_CONFIG_ENCRYPTION_KEY "$ai_configuration_encryption_key" '^[a-fA-F0-9]{64}$'
if [[ -n "$platform_credential_encryption_key" ]]; then
  require_pattern PLATFORM_CREDENTIAL_ENCRYPTION_KEY "$platform_credential_encryption_key" '^[a-fA-F0-9]{64}$'
fi

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

if [[ "$feishu_qr_registration_enabled" != 'true' && "$feishu_qr_registration_enabled" != 'false' ]]; then
  echo 'FEISHU_QR_REGISTRATION_ENABLED must be true or false' >&2
  exit 1
fi
if [[ "$feishu_qr_registration_enabled" == 'true' ]]; then
  require_pattern FEISHU_CREDENTIAL_ENCRYPTION_KEY "$feishu_credential_encryption_key" '^[a-fA-F0-9]{64}$'
  if [[ ! "$feishu_oauth_redirect_uri" =~ ^https:// ]]; then
    echo 'FEISHU_OAUTH_REDIRECT_URI must be an absolute HTTPS URL when QR registration is enabled' >&2
    exit 1
  fi
  if [[ "$feishu_oauth_redirect_uri" != "$public_url/api/integrations/feishu/callback" ]]; then
    echo 'FEISHU_OAUTH_REDIRECT_URI must be the canonical Feishu callback under NEXT_PUBLIC_SERVER_URL' >&2
    exit 1
  fi
fi

for value in "$ai_provider_base_url" "$ai_provider_api_key" "$ai_text_model" "$ai_embedding_model" "$ai_embedding_dimensions"; do
  if [[ -n "$value" ]]; then
    if [[ "$value" == *'REPLACE_'* || "$value" == *'replace-with'* ]]; then
      echo 'AI bootstrap variables must not use template placeholders' >&2
      exit 1
    fi
  fi
done
if [[ -n "$ai_provider_base_url" && -z "$ai_provider_api_key" ]] || \
  [[ -z "$ai_provider_base_url" && -n "$ai_provider_api_key" ]]; then
  echo 'AI bootstrap endpoint and API key must be configured together' >&2
  exit 1
fi
if [[ -z "$ai_provider_base_url" && ( -n "$ai_text_model" || -n "$ai_embedding_model" ) ]]; then
  echo 'AI bootstrap models require an endpoint and API key' >&2
  exit 1
fi
if [[ -n "$ai_provider_base_url" && -z "$ai_text_model" && -z "$ai_embedding_model" ]]; then
  echo 'AI bootstrap endpoint and API key require a text or embedding model' >&2
  exit 1
fi
if [[ -n "$ai_embedding_model" ]]; then
  if [[ ! "$ai_embedding_dimensions" =~ ^[0-9]+$ ]] || \
    ((10#$ai_embedding_dimensions < 1 || 10#$ai_embedding_dimensions > 16384)); then
    echo 'AI_EMBEDDING_DIMENSIONS must be an integer between 1 and 16384 when AI_EMBEDDING_MODEL is set' >&2
    exit 1
  fi
elif [[ -n "$ai_embedding_dimensions" ]]; then
  echo 'AI_EMBEDDING_DIMENSIONS requires AI_EMBEDDING_MODEL' >&2
  exit 1
fi

if [[ -n "$reasoning_enabled" && "$reasoning_enabled" != 'true' && "$reasoning_enabled" != 'false' ]]; then
  echo 'AI_REASONING_ENABLED must be true or false when set' >&2
  exit 1
fi

case "$reasoning_effort" in
  ''|none|minimal|low|medium|high|xhigh|max) ;;
  *)
    echo 'AI_REASONING_EFFORT must be one of none, minimal, low, medium, high, xhigh or max when set' >&2
    exit 1
    ;;
esac

if [[ -n "$meta_webhook_app_secret" || -n "$meta_webhook_verify_token" || -n "$meta_webhook_allowed_account_ids" ]]; then
  for key in META_WEBHOOK_APP_SECRET META_WEBHOOK_VERIFY_TOKEN META_WEBHOOK_ALLOWED_ACCOUNT_IDS; do
    case "$key" in
      META_WEBHOOK_APP_SECRET) value="$meta_webhook_app_secret" ;;
      META_WEBHOOK_VERIFY_TOKEN) value="$meta_webhook_verify_token" ;;
      META_WEBHOOK_ALLOWED_ACCOUNT_IDS) value="$meta_webhook_allowed_account_ids" ;;
    esac
    if [[ -z "$value" || "$value" == *'REPLACE_'* || "$value" == *'replace-with'* ]]; then
      echo "META_WEBHOOK_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN and META_WEBHOOK_ALLOWED_ACCOUNT_IDS must be configured together when Meta ingress is enabled (missing or invalid: $key)" >&2
      exit 1
    fi
  done
  if [[ "$meta_webhook_allowed_account_ids" == ,* || "$meta_webhook_allowed_account_ids" == *, || "$meta_webhook_allowed_account_ids" == *',,'* ]]; then
    echo 'META_WEBHOOK_ALLOWED_ACCOUNT_IDS must be a comma-separated list without empty values' >&2
    exit 1
  fi
fi

if [[ -n "$meta_app_id" || -n "$meta_login_config_id" || -n "$meta_oauth_redirect_uri" ]]; then
  for key in META_APP_ID META_LOGIN_CONFIG_ID META_OAUTH_REDIRECT_URI META_WEBHOOK_APP_SECRET; do
    case "$key" in
      META_APP_ID) value="$meta_app_id" ;;
      META_LOGIN_CONFIG_ID) value="$meta_login_config_id" ;;
      META_OAUTH_REDIRECT_URI) value="$meta_oauth_redirect_uri" ;;
      META_WEBHOOK_APP_SECRET) value="$meta_webhook_app_secret" ;;
    esac
    if [[ -z "$value" || "$value" == *'REPLACE_'* || "$value" == *'replace-with'* ]]; then
      echo "META_APP_ID, META_LOGIN_CONFIG_ID, META_OAUTH_REDIRECT_URI and META_WEBHOOK_APP_SECRET must be configured together when Meta OAuth is enabled (missing or invalid: $key)" >&2
      exit 1
    fi
  done
  require_pattern META_APP_ID "$meta_app_id" '^[1-9][0-9]{5,31}$'
  require_pattern META_LOGIN_CONFIG_ID "$meta_login_config_id" '^[1-9][0-9]{5,31}$'
  if [[ "$meta_oauth_redirect_uri" != 'https://ivybm.com/api/platforms/meta/oauth/callback' ]]; then
    echo 'META_OAUTH_REDIRECT_URI must be https://ivybm.com/api/platforms/meta/oauth/callback in production' >&2
    exit 1
  fi
  if [[ -z "$platform_credential_encryption_key" ]]; then
    echo 'PLATFORM_CREDENTIAL_ENCRYPTION_KEY is required when Meta OAuth is enabled' >&2
    exit 1
  fi
fi

if [[ -n "$instagram_app_id" || -n "$instagram_app_secret" || -n "$instagram_oauth_redirect_uri" ]]; then
  for key in INSTAGRAM_APP_ID INSTAGRAM_APP_SECRET INSTAGRAM_OAUTH_REDIRECT_URI; do
    case "$key" in
      INSTAGRAM_APP_ID) value="$instagram_app_id" ;;
      INSTAGRAM_APP_SECRET) value="$instagram_app_secret" ;;
      INSTAGRAM_OAUTH_REDIRECT_URI) value="$instagram_oauth_redirect_uri" ;;
    esac
    if [[ -z "$value" || "$value" == *'REPLACE_'* || "$value" == *'replace-with'* ]]; then
      echo "INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET and INSTAGRAM_OAUTH_REDIRECT_URI must be configured together when Instagram OAuth is enabled (missing or invalid: $key)" >&2
      exit 1
    fi
  done
  require_pattern INSTAGRAM_APP_ID "$instagram_app_id" '^[1-9][0-9]{5,31}$'
  if [[ "$instagram_oauth_redirect_uri" != 'https://ivybm.com/api/platforms/instagram/oauth/callback' ]]; then
    echo 'INSTAGRAM_OAUTH_REDIRECT_URI must be https://ivybm.com/api/platforms/instagram/oauth/callback in production' >&2
    exit 1
  fi
  if [[ -z "$platform_credential_encryption_key" ]]; then
    echo 'PLATFORM_CREDENTIAL_ENCRYPTION_KEY is required when Instagram OAuth is enabled' >&2
    exit 1
  fi
fi

if grep -Eq '^[[:space:]]*SEED_ADMIN_(EMAIL|PASSWORD)=' "$env_file"; then
  echo 'Production environment must not contain demo seed credentials' >&2
  exit 1
fi

echo 'Production environment preflight passed; no values were printed.'
