# Instagram Webhook payload compatibility hotfix

- Date: 2026-08-29
- Branch: `fix/instagram-webhook-payload-compat`
- Source: production Instagram tester messages reach `/api/webhooks/meta` but return `400 invalid_payload`.

## Goal and acceptance

- Keep documented `entry[].messaging[].message` inbound messages working unchanged.
- Accept the current Meta dashboard `entry[].changes[]` wrapper when it contains a supported Instagram message envelope.
- Ignore recognized non-inbound/control callbacks without creating conversations or jobs.
- Reject unknown or malformed payloads without accepting spoofed account IDs, stale events, invalid signatures, or empty messages.
- Emit bounded structural diagnostics for rejected payloads. Diagnostics must never contain message text, attachment URLs, access tokens, signatures, sender IDs, or recipient IDs.
- Facebook Messenger behavior must not regress.

Production acceptance is one fresh Instagram tester DM that returns HTTP 200, creates one idempotent platform event job, and appears once in `/dashboard/conversations`. A control callback must return 200 with zero accepted events and must not create a conversation.

## Non-goals

- No company verification, App Review, OAuth scope, database schema, migration, retry-policy, UI, or production environment changes.
- No logging of webhook bodies or customer message content.
- No invented support for undocumented outbound events.

## Technical plan and risks

Normalize both supported Meta container shapes into the existing strict message-envelope parser. Keep signature, freshness, allowlist, account authorization, idempotency, and rate limits in the existing ingestion layer. Add only a sanitized payload-shape diagnostic at the HTTP error boundary.

The main risks are treating a control callback as an inbound message, allowing an account ID from the wrong nesting level, or leaking private message content in logs. Tests therefore cover the two container shapes, ignored callbacks, malformed changes, account-ID preservation, and diagnostic redaction.

## Tests defined before implementation

| ID | Setup | Expected result |
| --- | --- | --- |
| IG-WH-01 | Existing `entry[].messaging[].message` fixture | One normalized Instagram inbound event |
| IG-WH-02 | `entry[].changes[]` containing a supported message envelope | One equivalent normalized inbound event |
| IG-WH-03 | Dashboard-style `changes[]` control/sample event | Zero events, no exception |
| IG-WH-04 | Reaction/read/edit/delivery callback without a complete inbound message | Zero events, no job |
| IG-WH-05 | Unknown malformed `changes[]` entry | `invalid_payload`, sanitized structural diagnostic only |
| IG-WH-06 | Facebook Page fixture | Existing Facebook normalization remains unchanged |
| IG-WH-07 | Invalid signature, stale event, or unauthorized account | Existing failure code remains unchanged |

Rollback is the single hotfix commit; no data rollback is required.

## Verification result

- Production access-log evidence showed Meta reached the callback and returned `400` with the exact `invalid_payload` response size; invalid signature was not the active failure class.
- Contract tests cover documented messaging envelopes, direct and array change wrappers, dashboard dummy events, controls, account separation, recipient matching, attachment sanitization, and malformed payloads.
- HTTP tests cover signature selection, challenge verification, account authorization, rate limits, idempotency, delayed retry, diagnostics redaction, and diagnostic-sink isolation.
- Passed: Meta contract 13/13, Meta HTTP unit 12/12, changed-file ESLint, TypeScript typecheck, and `git diff --check`.
- Production acceptance remains pending merge, approved deployment, and one fresh tester DM. A successful local fixture cannot prove Meta delivered the real DM event.
