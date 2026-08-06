# Requirements review

## Scope

- Replace customer-managed App ID / Secret onboarding with Feishu's official QR app registration.
- Configure the tenant app, complete user OAuth, and create the CRM Base asynchronously.
- Keep the existing store OAuth path as an operations-compatible fallback.
- Preserve admin-only access, encrypted credentials, idempotent jobs, retries, and disconnect behavior.

## Non-goals

- Feishu-to-IVYBM bidirectional record sync.
- Enterprise-only Base permissions or workflows.
- Production enablement without a controlled smoke test and human approval.

## Acceptance

- A free Feishu tenant can create and authorize its own app without copying credentials.
- The registration secret moves to the connection and is cleared from the completed registration.
- One durable provisioning job creates one Base/table and activates the primary mapping.
- Retry, callback replay, process interruption, and migration rollback fail safely.
