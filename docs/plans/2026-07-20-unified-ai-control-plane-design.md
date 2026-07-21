# Unified AI Control Plane Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide one admin-only Payload CMS entry point for OpenAI-compatible providers, encrypted API keys, model profiles, and stable usage-route selection across every AI capability.

**Architecture:** Three admin-only collections form the control plane: `AiProviders` holds protocol, endpoint and encrypted credential; `AiModelProfiles` holds model-specific parameters; `AiUsageRoutes` maps a stable usage key to a profile. The server reads one immutable database snapshot per AI request and constructs operation-specific providers, so text and embedding can use different providers or models. Existing environment variables remain an empty-registry bootstrap fallback; the only mandatory deployment secret for CMS-managed credentials is `AI_CONFIG_ENCRYPTION_KEY`.

**Tech Stack:** Payload CMS 3.86, PostgreSQL 18.4, TypeScript, Node.js `crypto` AES-256-GCM, Vitest, Docker Compose.

---

### Task 1: Define encrypted provider credentials and model-routing contracts

**Files:**

- Create: `src/modules/ai/credentials.ts`
- Create: `src/modules/ai/registry.ts`
- Create: `tests/unit/ai-credentials.test.ts`
- Modify: `src/modules/ai/config.ts`
- Modify: `src/modules/ai/gateway.ts`
- Modify: `tests/unit/ai-config.test.ts`
- Modify: `tests/contract/ai-gateway.test.ts`

**Step 1: Write failing unit tests.**

Cover a 64-character hexadecimal `AI_CONFIG_ENCRYPTION_KEY`, AES-256-GCM round trip, tamper rejection, no key disclosure in errors, model-profile validation, and environment fallback when no route exists. Cover provider-per-operation routing so text and embeddings may use separate compatible providers.

**Step 2: Run the targeted tests.**

Run: `pnpm vitest run --config ./vitest.config.mts tests/unit/ai-credentials.test.ts tests/unit/ai-config.test.ts`

Expected: FAIL because the registry and encryption helpers do not exist.

**Step 3: Implement pure server-only primitives.**

Use a versioned AES-GCM payload (`v1:<iv>:<tag>:<ciphertext>`), accept only a 32-byte hex master key, and keep plaintext confined to a local provider-construction scope. Extend the gateway with optional per-operation providers while preserving its existing public call shape and usage reporting.

**Step 4: Verify the targeted unit and contract tests.**

Run: `pnpm test:unit && pnpm test:contract -- tests/contract/ai-gateway.test.ts`

Expected: PASS without a network call or a plaintext API key in snapshots/logs.

### Task 2: Add admin-only Payload control-plane collections

**Files:**

- Create: `src/collections/AiProviders.ts`
- Create: `src/collections/AiModelProfiles.ts`
- Create: `src/collections/AiUsageRoutes.ts`
- Modify: `src/payload.config.ts`
- Modify: `src/migrations/index.ts`
- Create: `src/migrations/<timestamp>_ai_control_plane.ts`
- Create: `src/migrations/<timestamp>_ai_control_plane.json`
- Modify: `src/payload-types.ts` (generated only)
- Create: `tests/integration/ai-control-plane.test.ts`

**Step 1: Write failing integration tests.**

Assert that only admin can create/read/update/delete providers, profiles and routes; anonymous/operator/sales are denied. Confirm that stored provider key is encrypted, public REST/GraphQL responses never contain it, blank updates preserve an already configured key, and route keys are unique.

**Step 2: Implement the minimal schema.**

`AiProviders` has a display name, enabled flag, `openai-compatible` protocol, HTTPS endpoint (HTTP only outside production), and a write-only encrypted API-key field. `AiModelProfiles` references one provider and holds one capability (`text` or `embedding`), provider model ID, timeout, optional max-output tokens/dimensions, and reasoning settings. `AiUsageRoutes` has unique `usageKey` and references one enabled profile. Use the existing admin-only access pattern; do not place these fields in publicly-readable `SiteSettings`.

**Step 3: Generate and review migration and types.**

Run: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ivybm_test pnpm db:migrate:create ai-control-plane && pnpm generate:types`

Expected: a forward-compatible new-table migration only. Inspect the generated SQL; do not alter any merged migration.

**Step 4: Run migration and integration tests on the protected test database.**

Run: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ivybm_test pnpm db:reset:test && DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ivybm_test pnpm test:integration -- tests/integration/ai-control-plane.test.ts`

Expected: PASS; no key is present in returned documents, error strings, or audit payloads.

### Task 3: Resolve routes once per request and apply them to chat

**Files:**

- Modify: `src/modules/conversations/runtime.ts`
- Modify: `src/modules/knowledge/embed.ts` if direct registry injection is needed
- Modify: `tests/integration/chat-api.test.ts`
- Modify: `tests/integration/knowledge/retrieve.test.ts`

**Step 1: Write failing runtime tests.**

Create one provider/profile/route pair for `chat.reply` and another for `knowledge.embedding`; assert that a chat request sends each operation to its assigned model/provider. Assert empty routes use existing environment fallback. Assert a changed embedding route produces no cross-model retrieval result until the document is re-indexed.

**Step 2: Implement a single snapshot resolver.**

Load all required routes and their provider/profile relations in one internal Payload read at chat-service creation; validate and decrypt only selected providers; freeze the result for the request. Reuse its one gateway for both retrieve/embed and text generation. Do not cache configuration indefinitely: an admin save must apply to the next request.

**Step 3: Verify fallback and isolation.**

Run: `pnpm test:integration -- tests/integration/chat-api.test.ts tests/integration/knowledge/retrieve.test.ts`

Expected: PASS with the current environment-only configuration and with CMS-selected provider/model fixtures.

### Task 4: Make deployment configuration bootstrap-only and document operations

**Files:**

- Modify: `.env.example`
- Modify: `.env.production.example`
- Modify: `compose.prod.yaml`
- Modify: `compose.staging.yaml`
- Modify: `scripts/preflight-production.sh`
- Modify: `tests/operations/compose.test.ts`
- Modify: `tests/operations/preflight-production.test.ts`
- Modify: `docs/operations/部署手册.md`
- Modify: `docs/architecture/一期技术选型与部署架构规划.md`
- Modify: `docs/开发进度.md`

**Step 1: Write failing operational tests.**

Assert production can start with an empty CMS registry and existing environment fallback, accepts no provider API key when a CMS provider will be configured, requires a valid `AI_CONFIG_ENCRYPTION_KEY`, and never interpolates the master key into logs.

**Step 2: Implement the deployment contract.**

Make old `AI_PROVIDER_*` values optional bootstrap defaults. Inject `AI_CONFIG_ENCRYPTION_KEY` into app and worker only, validate it without printing it, and document the one-time server value plus encrypted CMS key workflow.

**Step 3: Verify operations.**

Run: `pnpm test:operations && docker compose -f compose.yaml -f compose.prod.yaml config --quiet`

Expected: PASS with placeholders only and no secrets in output.

### Task 5: Complete quality gates and submit the replacement PR

**Files:**

- Modify: `.github/pull_request_template.md` only if the existing checklist cannot describe the new review path.

**Step 1: Run all gates.**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:contract && DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ivybm_test pnpm test:integration && pnpm test:operations && pnpm build`

Expected: PASS.

**Step 2: Review secrets and migration diff.**

Run: `git diff --check && git diff --cached --check && git status --short`

Expected: no `.env`, ciphertext/plaintext fixture leak, unrelated schema change, or generated-file manual edit.

**Step 3: Commit and submit a new PR.**

Use a Task 8 title, state that `src/payload.config.ts`, a migration, and a shared AI gateway contract changed, and request xuemusi review. Do not merge or deploy production automatically.
