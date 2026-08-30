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

# Docker Compose gives exported shell variables precedence over --env-file.
# Reject release variables from the caller so the reviewed env file remains the
# single source of truth for both preflight and the final container config.
release_environment_keys=(
  IMAGE_TAG RUNTIME_IMAGE RUNTIME_IMAGE_DIGEST WORKER_IMAGE WORKER_IMAGE_DIGEST APP_VERSION
  POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL PAYLOAD_SECRET NEXT_PUBLIC_SERVER_URL APP_PORT
  CLOUDFLARE_CACHE_PURGE_ENABLED CLOUDFLARE_ZONE_ID CLOUDFLARE_API_TOKEN
  TRUST_PROXY_HEADERS ADMIN_PORTAL_ENABLED ADMIN_PORTAL_SETTINGS_ENABLED ADMIN_PORTAL_TEAM_MANAGEMENT_ENABLED
  ADMIN_PORTAL_OVERVIEW_ENABLED
  ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED ADMIN_PORTAL_MEDIA_ENABLED ADMIN_PORTAL_KNOWLEDGE_ENABLED
  ADMIN_PORTAL_CONVERSATIONS_ENABLED ADMIN_PORTAL_LEADS_ENABLED ADMIN_PORTAL_CONTENT_STUDIO_ENABLED
  ADMIN_PORTAL_PLATFORMS_ENABLED ADMIN_PORTAL_OPERATIONS_ENABLED ADMIN_PORTAL_PUBLISHING_ENABLED
  AI_CONFIG_ENCRYPTION_KEY PLATFORM_CREDENTIAL_ENCRYPTION_KEY AI_PROVIDER_BASE_URL AI_PROVIDER_API_KEY
  AI_TEXT_MODEL AI_EMBEDDING_MODEL AI_EMBEDDING_DIMENSIONS AI_TEXT_TIMEOUT_MS AI_EMBEDDING_TIMEOUT_MS
  WEBHOOK_REPLAY_ENCRYPTION_KEY
  AI_REASONING_ENABLED AI_REASONING_EFFORT META_WEBHOOK_APP_SECRET META_WEBHOOK_VERIFY_TOKEN
  META_WEBHOOK_ALLOWED_ACCOUNT_IDS META_APP_ID META_LOGIN_CONFIG_ID META_OAUTH_REDIRECT_URI
  INSTAGRAM_APP_ID INSTAGRAM_APP_SECRET INSTAGRAM_OAUTH_REDIRECT_URI LINKEDIN_APP_ID
  LINKEDIN_APP_SECRET LINKEDIN_OAUTH_REDIRECT_URI LINKEDIN_API_VERSION
  LINKEDIN_UPLOAD_ALLOWED_ORIGINS LINKEDIN_UPLOAD_TICKET_KEY FEISHU_APP_ID FEISHU_APP_SECRET FEISHU_OAUTH_REDIRECT_URI
  FEISHU_CREDENTIAL_ENCRYPTION_KEY FEISHU_QR_REGISTRATION_ENABLED FEISHU_RELAY_INTERVAL_MS
  FEISHU_OAUTH_RECOVERY_INTERVAL_MS WORKER_HEARTBEAT_INTERVAL_MS WORKER_JOB_HEARTBEAT_INTERVAL_MS
  WORKER_POLL_INTERVAL_MS
)

for key in "${release_environment_keys[@]}"; do
  if printenv "$key" >/dev/null 2>&1; then
    echo "Production release variable must be unset in the caller environment: $key" >&2
    exit 1
  fi
done

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
app_port="$(read_env_value APP_PORT)"
postgres_password="$(read_env_value POSTGRES_PASSWORD)"
database_url="$(read_env_value DATABASE_URL)"
payload_secret="$(read_env_value PAYLOAD_SECRET)"
public_url="$(read_env_value NEXT_PUBLIC_SERVER_URL)"
cloudflare_cache_purge_enabled="$(read_env_value CLOUDFLARE_CACHE_PURGE_ENABLED)"
cloudflare_zone_id="$(read_optional_env_value CLOUDFLARE_ZONE_ID)"
cloudflare_api_token="$(read_optional_env_value CLOUDFLARE_API_TOKEN)"
trust_proxy_headers="$(read_env_value TRUST_PROXY_HEADERS)"
portal_enabled="$(read_env_value ADMIN_PORTAL_ENABLED)"
portal_settings_enabled="$(read_env_value ADMIN_PORTAL_SETTINGS_ENABLED)"
portal_team_management_enabled="$(read_env_value ADMIN_PORTAL_TEAM_MANAGEMENT_ENABLED)"
portal_overview_enabled="$(read_env_value ADMIN_PORTAL_OVERVIEW_ENABLED)"
portal_website_content_enabled="$(read_env_value ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED)"
portal_media_enabled="$(read_env_value ADMIN_PORTAL_MEDIA_ENABLED)"
portal_knowledge_enabled="$(read_env_value ADMIN_PORTAL_KNOWLEDGE_ENABLED)"
portal_conversations_enabled="$(read_env_value ADMIN_PORTAL_CONVERSATIONS_ENABLED)"
portal_leads_enabled="$(read_env_value ADMIN_PORTAL_LEADS_ENABLED)"
portal_content_studio_enabled="$(read_env_value ADMIN_PORTAL_CONTENT_STUDIO_ENABLED)"
portal_platforms_enabled="$(read_env_value ADMIN_PORTAL_PLATFORMS_ENABLED)"
portal_operations_enabled="$(read_env_value ADMIN_PORTAL_OPERATIONS_ENABLED)"
portal_publishing_enabled="$(read_env_value ADMIN_PORTAL_PUBLISHING_ENABLED)"
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
webhook_replay_encryption_key="$(read_optional_env_value WEBHOOK_REPLAY_ENCRYPTION_KEY)"
meta_app_id="$(read_optional_env_value META_APP_ID)"
meta_login_config_id="$(read_optional_env_value META_LOGIN_CONFIG_ID)"
meta_oauth_redirect_uri="$(read_optional_env_value META_OAUTH_REDIRECT_URI)"
instagram_app_id="$(read_optional_env_value INSTAGRAM_APP_ID)"
instagram_app_secret="$(read_optional_env_value INSTAGRAM_APP_SECRET)"
instagram_oauth_redirect_uri="$(read_optional_env_value INSTAGRAM_OAUTH_REDIRECT_URI)"
linkedin_app_id="$(read_optional_env_value LINKEDIN_APP_ID)"
linkedin_app_secret="$(read_optional_env_value LINKEDIN_APP_SECRET)"
linkedin_oauth_redirect_uri="$(read_optional_env_value LINKEDIN_OAUTH_REDIRECT_URI)"
linkedin_api_version="$(read_optional_env_value LINKEDIN_API_VERSION)"
linkedin_upload_allowed_origins="$(read_optional_env_value LINKEDIN_UPLOAD_ALLOWED_ORIGINS)"
linkedin_upload_ticket_key="$(read_optional_env_value LINKEDIN_UPLOAD_TICKET_KEY)"
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

if [[ ! "$app_port" =~ ^[1-9][0-9]{0,4}$ ]] || ((10#$app_port > 65535)); then
  echo 'APP_PORT must be an integer between 1 and 65535' >&2
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

if [[ "$cloudflare_cache_purge_enabled" != 'true' && "$cloudflare_cache_purge_enabled" != 'false' ]]; then
  echo 'CLOUDFLARE_CACHE_PURGE_ENABLED must be true or false' >&2
  exit 1
fi
if [[ "$cloudflare_cache_purge_enabled" == 'true' ]]; then
  require_pattern CLOUDFLARE_ZONE_ID "$cloudflare_zone_id" '^[a-fA-F0-9]{32}$'
  require_pattern CLOUDFLARE_API_TOKEN "$cloudflare_api_token" '^[A-Za-z0-9_-]{40,128}$'
fi

if [[ "$trust_proxy_headers" != 'true' ]]; then
  echo 'TRUST_PROXY_HEADERS must be true behind the sole OpenResty ingress' >&2
  exit 1
fi

if [[ "$portal_enabled" != 'true' && "$portal_enabled" != 'false' ]]; then
  echo 'ADMIN_PORTAL_ENABLED must be true or false' >&2
  exit 1
fi
for key_value in \
  "ADMIN_PORTAL_SETTINGS_ENABLED=$portal_settings_enabled" \
  "ADMIN_PORTAL_TEAM_MANAGEMENT_ENABLED=$portal_team_management_enabled" \
  "ADMIN_PORTAL_OVERVIEW_ENABLED=$portal_overview_enabled" \
  "ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED=$portal_website_content_enabled" \
  "ADMIN_PORTAL_MEDIA_ENABLED=$portal_media_enabled" \
  "ADMIN_PORTAL_KNOWLEDGE_ENABLED=$portal_knowledge_enabled" \
  "ADMIN_PORTAL_CONVERSATIONS_ENABLED=$portal_conversations_enabled" \
  "ADMIN_PORTAL_LEADS_ENABLED=$portal_leads_enabled" \
  "ADMIN_PORTAL_CONTENT_STUDIO_ENABLED=$portal_content_studio_enabled" \
  "ADMIN_PORTAL_PLATFORMS_ENABLED=$portal_platforms_enabled" \
  "ADMIN_PORTAL_OPERATIONS_ENABLED=$portal_operations_enabled"; do
  key="${key_value%%=*}"
  value="${key_value#*=}"
  if [[ "$value" != 'true' && "$value" != 'false' ]]; then
    echo "$key must be true or false" >&2
    exit 1
  fi
done
if [[ "$portal_publishing_enabled" != 'true' && "$portal_publishing_enabled" != 'false' ]]; then
  echo 'ADMIN_PORTAL_PUBLISHING_ENABLED must be true or false' >&2
  exit 1
fi

if [[ "$portal_publishing_enabled" == 'true' ]]; then
  require_pattern PLATFORM_CREDENTIAL_ENCRYPTION_KEY "$platform_credential_encryption_key" '^[a-fA-F0-9]{64}$'
fi

if [[ -n "$linkedin_upload_allowed_origins$linkedin_upload_ticket_key" ]]; then
  require_pattern LINKEDIN_API_VERSION "$linkedin_api_version" '^20[0-9]{2}(0[1-9]|1[0-2])$'
  require_pattern LINKEDIN_UPLOAD_TICKET_KEY "$linkedin_upload_ticket_key" '^[a-fA-F0-9]{64}$'
  if [[ -z "$linkedin_upload_allowed_origins" || "$linkedin_upload_allowed_origins" == *'REPLACE_'* || "$linkedin_upload_allowed_origins" == *'replace-with'* ]]; then
    echo 'LINKEDIN_UPLOAD_ALLOWED_ORIGINS is required when LinkedIn uploads are configured' >&2
    exit 1
  fi
  IFS=',' read -r -a linkedin_upload_origins <<<"$linkedin_upload_allowed_origins"
  for origin in "${linkedin_upload_origins[@]}"; do
    if [[ ! "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
      echo 'LINKEDIN_UPLOAD_ALLOWED_ORIGINS must contain exact comma-separated HTTPS origins' >&2
      exit 1
    fi
  done
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
  require_pattern WEBHOOK_REPLAY_ENCRYPTION_KEY "$webhook_replay_encryption_key" '^[a-fA-F0-9]{64}$'
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
  if [[ -z "$meta_webhook_verify_token" ]]; then
    echo 'META_WEBHOOK_VERIFY_TOKEN is required when Instagram messaging ingress is enabled' >&2
    exit 1
  fi
  require_pattern WEBHOOK_REPLAY_ENCRYPTION_KEY "$webhook_replay_encryption_key" '^[a-fA-F0-9]{64}$'
fi

if [[ -n "$linkedin_app_id" || -n "$linkedin_app_secret" || -n "$linkedin_oauth_redirect_uri" ]]; then
  for key in LINKEDIN_APP_ID LINKEDIN_APP_SECRET LINKEDIN_OAUTH_REDIRECT_URI; do
    case "$key" in
      LINKEDIN_APP_ID) value="$linkedin_app_id" ;;
      LINKEDIN_APP_SECRET) value="$linkedin_app_secret" ;;
      LINKEDIN_OAUTH_REDIRECT_URI) value="$linkedin_oauth_redirect_uri" ;;
    esac
    if [[ -z "$value" || "$value" == *'REPLACE_'* || "$value" == *'replace-with'* ]]; then
      echo "LINKEDIN_APP_ID, LINKEDIN_APP_SECRET and LINKEDIN_OAUTH_REDIRECT_URI must be configured together when LinkedIn OAuth is enabled (missing or invalid: $key)" >&2
      exit 1
    fi
  done
  require_pattern LINKEDIN_APP_ID "$linkedin_app_id" '^[A-Za-z0-9_-]{1,128}$'
  require_pattern LINKEDIN_API_VERSION "$linkedin_api_version" '^20[0-9]{2}(0[1-9]|1[0-2])$'
  if [[ "$linkedin_oauth_redirect_uri" != 'https://ivybm.com/api/platforms/linkedin/oauth/callback' ]]; then
    echo 'LINKEDIN_OAUTH_REDIRECT_URI must be https://ivybm.com/api/platforms/linkedin/oauth/callback in production' >&2
    exit 1
  fi
  if [[ -z "$platform_credential_encryption_key" ]]; then
    echo 'PLATFORM_CREDENTIAL_ENCRYPTION_KEY is required when LinkedIn OAuth is enabled' >&2
    exit 1
  fi
fi

if grep -Eq '^[[:space:]]*SEED_ADMIN_(EMAIL|PASSWORD)=' "$env_file"; then
  echo 'Production environment must not contain demo seed credentials' >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  echo 'Production preflight requires docker and python3 to validate the final Compose configuration' >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_config_file="$(mktemp)"
trap 'rm -f "$compose_config_file"' EXIT

if ! "$script_dir/production-compose.sh" "$env_file" config --format json >"$compose_config_file"; then
  echo 'Production Compose configuration failed to resolve from the reviewed env file' >&2
  exit 1
fi

python3 - "$compose_config_file" "$image_tag" "$runtime_image" "$runtime_digest" "$worker_image" "$worker_digest" "$app_port" <<'PY'
import json
import sys

config_path, image_tag, runtime_image, runtime_digest, worker_image, worker_digest, app_port = sys.argv[1:]
with open(config_path, encoding='utf-8') as handle:
    config = json.load(handle)

services = config.get('services', {})
app = services.get('app', {})
worker = services.get('worker', {})
migrate = services.get('migrate', {})
app_environment = app.get('environment', {})
worker_environment = worker.get('environment', {})

expected_images = {
    'app': f'{runtime_image}:{image_tag}@{runtime_digest}',
    'worker': f'{worker_image}:{image_tag}@{worker_digest}',
    'migrate': f'{worker_image}:{image_tag}@{worker_digest}',
}
for service_name, expected in expected_images.items():
    actual = services.get(service_name, {}).get('image')
    if actual != expected:
        raise SystemExit(f'Compose {service_name} image does not match the env-file release reference')

portal_keys = [
    'ADMIN_PORTAL_ENABLED',
    'ADMIN_PORTAL_SETTINGS_ENABLED',
    'ADMIN_PORTAL_TEAM_MANAGEMENT_ENABLED',
    'ADMIN_PORTAL_OVERVIEW_ENABLED',
    'ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED',
    'ADMIN_PORTAL_MEDIA_ENABLED',
    'ADMIN_PORTAL_KNOWLEDGE_ENABLED',
    'ADMIN_PORTAL_CONVERSATIONS_ENABLED',
    'ADMIN_PORTAL_LEADS_ENABLED',
    'ADMIN_PORTAL_CONTENT_STUDIO_ENABLED',
    'ADMIN_PORTAL_PLATFORMS_ENABLED',
    'ADMIN_PORTAL_OPERATIONS_ENABLED',
]
for key in portal_keys:
    if app_environment.get(key) not in {'true', 'false'}:
        raise SystemExit(f'Compose app environment has an invalid {key}')
publishing_enabled = app_environment.get('ADMIN_PORTAL_PUBLISHING_ENABLED')
if publishing_enabled not in {'true', 'false'}:
    raise SystemExit('Compose app environment has an invalid ADMIN_PORTAL_PUBLISHING_ENABLED')
conversations_enabled = app_environment.get('ADMIN_PORTAL_CONVERSATIONS_ENABLED')
if worker_environment.get('ADMIN_PORTAL_CONVERSATIONS_ENABLED') != conversations_enabled:
    raise SystemExit('Compose app and worker conversation switches must match')
if worker_environment.get('ADMIN_PORTAL_PUBLISHING_ENABLED') != publishing_enabled:
    raise SystemExit('Compose app and worker publishing switches must match')
if publishing_enabled == 'true':
    if not worker_environment.get('PLATFORM_CREDENTIAL_ENCRYPTION_KEY'):
        raise SystemExit('Compose worker environment is missing PLATFORM_CREDENTIAL_ENCRYPTION_KEY')
cloudflare_enabled = app_environment.get('CLOUDFLARE_CACHE_PURGE_ENABLED')
if cloudflare_enabled not in {'true', 'false'}:
    raise SystemExit('Compose app environment has an invalid CLOUDFLARE_CACHE_PURGE_ENABLED')
if cloudflare_enabled == 'true':
    for key in ('CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_API_TOKEN'):
        if not app_environment.get(key):
            raise SystemExit(f'Compose app environment is missing {key}')
for service_name, environment in (('migrate', migrate.get('environment', {})), ('worker', worker_environment)):
    for key in ('CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_API_TOKEN'):
        if environment.get(key):
            raise SystemExit(f'Compose {service_name} environment must not receive {key}')
linkedin_keys = (
    'LINKEDIN_API_VERSION',
    'LINKEDIN_UPLOAD_ALLOWED_ORIGINS',
    'LINKEDIN_UPLOAD_TICKET_KEY',
)
if any(worker_environment.get(key) for key in linkedin_keys[1:]):
    for key in linkedin_keys:
        if not worker_environment.get(key):
            raise SystemExit(f'Compose worker environment is missing {key}')
if app.get('build') is not None or worker.get('build') is not None or migrate.get('build') is not None:
    raise SystemExit('Production services must use immutable images and must not build on the server')
ports = app.get('ports', [])
if len(ports) != 1:
    raise SystemExit('Production app must expose exactly one loopback port')
port = ports[0]
if (
    port.get('host_ip') != '127.0.0.1'
    or str(port.get('published')) != app_port
    or str(port.get('target')) != '3000'
):
    raise SystemExit('Production app must remain bound to the reviewed loopback APP_PORT')
PY

echo 'Production environment preflight passed; no values were printed.'
