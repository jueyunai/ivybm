# Meta Webhook identity and replay hardening

- Date: 2026-08-30
- Owner: xuemusi
- Scope: Task 13 Instagram DM production blocker
- Delivery: one Draft PR with two checkpoints

## Source and goal

Production proved that `ivymetalglass` has two provider identifiers: the Instagram OAuth/profile ID used for token, subscription and publishing, and a distinct Instagram Messaging participant/recipient ID used by DM Webhooks. The current `PlatformAccounts.externalAccountId` field and Meta allowlist treat them as one identity, causing signed real DMs to fail with `403 unauthorized_account`.

Rejected callbacks currently disappear before `rawPayloadDigest` and Jobs persistence. Nginx retains only HTTP status, so a later investigation cannot reproduce the provider request without asking the customer to send another message.

Done means:

1. OAuth/publishing identity and messaging identity are stored separately and uniquely.
2. Instagram inbound authorization and token lookup use the messaging identity; OAuth, subscription and publishing retain the OAuth identity.
3. Every signature-verified Meta callback emits one content-free structured log with trace ID, body digest, outcome and optional replay record ID.
4. Signature-verified failures are encrypted with a dedicated key, retained at most 24 hours in an internal PostgreSQL table, and deduplicated by body digest and error code.
5. An operator can export a strictly sanitized JSON fixture on the server and run the same connector locally without database writes, Jobs or provider calls.
6. Invalid signatures, oversized bodies and requests that never pass HMAC verification are never persisted.

## Non-goals

- No separate Webhook container, Pod, reverse-proxy route or second copy of business logic.
- No browser/API access to encrypted callback bodies.
- No automatic replay into production Jobs and no provider side effects from the replay CLI.
- No plaintext callback body, sender ID, customer text, message ID, attachment URL, Token or signature in ordinary logs.
- No generic compensation center or retention beyond 24 hours.

## Data and authorization design

`PlatformAccounts.externalAccountId` remains the OAuth/publishing identity for compatibility. Add:

- `messagingExternalAccountId`: nullable provider messaging recipient identity;
- `messagingConnectionKey`: hidden unique key derived from account kind + messaging ID.

Migration backfills no Instagram messaging ID because it cannot be inferred safely from the OAuth ID. Existing Facebook behavior remains based on `externalAccountId`. Instagram OAuth attempts bounded discovery from the account's existing conversations and stores the unique participant ID whose username equals `/me.username`; no match or multiple matches leaves the field empty and readiness action-required. A server-only CLI provides the same discovery with dry-run by default and explicit confirmation for production backfill.

For Instagram, a signature-verified Webhook is authorized by the exact `messagingExternalAccountId` in one connected `instagram-professional` account. For Facebook Page, the existing environment allowlist and `externalAccountId` checks remain unchanged.

## Replay storage

Use an internal table, not a Payload Collection:

- `id`, `trace_id`, `provider_object`, `error_code`;
- `body_sha256`, `body_bytes`, `content_type`, structural metadata;
- AES-256-GCM ciphertext and key version;
- `received_at`, `last_received_at`, `expires_at`, `retry_count`, `exported_at`.

`WEBHOOK_REPLAY_ENCRYPTION_KEY` is a dedicated 64-hex server key injected into `app` and the server-side CLI only. It is not injected into `migrate`, `worker`, browser code or Payload records. Insert opportunistically removes expired rows and caps retained rows. Recording is best-effort and bounded to 250 ms from the HTTP response path; slow or failed storage is reported as `pending`/`failed` without changing the original public Webhook response.

Sanitized export preserves container shape and the equality/mismatch relationship between `entry.id` and `recipient.id`, but replaces both with stable one-way aliases. It also replaces sender IDs, message IDs, text, attachment URLs, quick-reply/referral payloads and unknown strings. Only strict allowlisted enum values and timestamps remain. The local replay command only calls normalization and prints a bounded summary.

## Tests defined before implementation

| ID | Setup | Expected result |
| --- | --- | --- |
| ID-01 | Instagram OAuth ID differs from Messaging ID | OAuth/publishing resolve by OAuth ID; inbound/token resolve only by Messaging ID |
| ID-02 | Duplicate Messaging ID on two accounts | unique-key conflict; no ambiguous account becomes ready |
| ID-03 | Existing Instagram row migration | OAuth ID retained; Messaging ID remains null and messaging readiness stays action-required |
| ID-04 | Facebook Page inbound | existing allowlist and `externalAccountId` behavior unchanged |
| ID-05 | Conversation discovery finds one matching username | Messaging ID stored under locked account update |
| ID-06 | Discovery finds zero/multiple matches | no mapping written; authorization remains usable for publishing |
| RP-01 | Invalid HMAC | 401, zero replay records, no callback body log |
| RP-02 | Valid HMAC + invalid payload/account/stale event | original error response preserved; encrypted record inserted once |
| RP-03 | Same provider retry | retry count/last seen update; no duplicate ciphertext row |
| RP-04 | Recorder/database failure | original Webhook response unchanged; fixed content-free recorder error log |
| RP-05 | Ciphertext tampering/wrong key | decryption fails closed without plaintext leakage |
| RP-06 | Export fixture | sender/text/mid/URLs/tokens/signature absent; entry/recipient shape retained |
| RP-07 | Local replay | connector result only; repository/provider call count remains zero |
| RP-08 | Retention | expired rows deleted and unexpired row cap enforced |
| OPS-01 | Production config | dedicated key required when Meta Webhook is enabled; app-only injection verified |

## Deployment and rollback

This change includes a migration and therefore requires the production backup gate, independent review and approved maintenance window. After migration, run the discovery CLI for the connected Instagram account, update the production account allowlist semantics/documentation, deploy app/worker, and send one fresh test DM.

Acceptance evidence is: signed callback log with trace ID and HTTP 200, one idempotent platform event Job, one Instagram conversation/message, and no plaintext customer content in app/worker logs. Rollback first disables replay recording and rolls back application code. Migration down must refuse while unexpired replay records exist; it must not delete active forensic data as an ordinary rollback step.
