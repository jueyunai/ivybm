# Portal AI Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an admin-only AI control plane to the new Portal settings page without exposing credentials or bypassing Payload access and validation.

**Architecture:** Add a Portal-specific safe read model and idempotent CRUD API over the existing AI provider, model profile, and usage route Collections. Render the control plane inside the existing settings module for admins only; keep operators and sales on the current settings experience.

**Tech Stack:** Next.js App Router, React, Payload CMS Local API, PostgreSQL command receipts, Vitest, Testing Library, Playwright.

---

### Task 1: Safe AI settings read model

**Files:**
- Create: `src/admin-portal/modules/settings/getPortalAiSettings.ts`
- Test: `tests/unit/admin-portal-ai-settings.test.ts`

1. Write failing tests for admin-only safe DTOs and readiness.
2. Run `pnpm test:unit -- tests/unit/admin-portal-ai-settings.test.ts` and verify failure.
3. Implement bounded `find` calls with `overrideAccess:false`, safe field mapping, and readiness for chat/content/embedding.
4. Re-run the test and verify pass.

### Task 2: Admin-only commands and routes

**Files:**
- Create: `src/admin-portal/modules/settings/aiSettingsCommands.ts`
- Create: `src/admin-portal/modules/settings/aiSettingsRoute.ts`
- Create: `src/app/api/portal/settings/ai/[resource]/route.ts`
- Create: `src/app/api/portal/settings/ai/[resource]/[id]/route.ts`
- Modify: `src/admin-portal/core/commands/portalCommandReceipts.ts`
- Test: `tests/unit/admin-portal-ai-settings-commands.test.ts`
- Test: `tests/unit/admin-portal-ai-settings-route.test.ts`

1. Write failing tests for auth, byte limits, validation, safe errors, and Payload calls using the transaction request.
2. Implement resource parsing and whitelisted create/update/delete inputs.
3. Execute writes through `executePortalRouteCommand` with resource/action scopes and row locks for updates/deletes.
4. Map Payload/AiCredential errors to stable responses without returning error messages that can contain credentials.
5. Run the two unit files and verify pass.

### Task 3: Portal UI

**Files:**
- Create: `src/admin-portal/modules/settings/AiSettingsPanel.tsx`
- Modify: `src/admin-portal/modules/settings/SettingsHub.tsx`
- Modify: `src/app/(dashboard)/dashboard/(protected)/settings/page.tsx`
- Modify: `src/admin-portal/core/i18n/types.ts`
- Modify: `src/admin-portal/core/i18n/zh.ts`
- Modify: `src/admin-portal/core/i18n/en.ts`
- Modify: `src/admin-portal/core/styles/portal.css`
- Modify: `tests/unit/admin-portal-settings.test.ts`

1. Write failing UI tests for admin visibility, secret non-disclosure, CRUD forms, and readiness.
2. Implement provider, profile, route editors with stable command-key sessions.
3. Add compact responsive styles and bilingual labels.
4. Run the settings UI tests and verify pass.

### Task 4: Database and browser verification

**Files:**
- Create: `tests/integration/admin-portal-ai-settings.test.ts`
- Create: `tests/e2e/admin-portal-ai-settings.spec.ts`

1. Add integration tests for admin CRUD, role denial, encryption, blank-key retention, and idempotent replay.
2. Add desktop/mobile Playwright coverage for the complete configuration flow.
3. Run isolated database migration/reset/seed, the integration file, and the E2E spec.
4. Inspect desktop and 390px screenshots for overflow, inaccessible labels, or secret exposure.

### Task 5: Final gates and progress record

**Files:**
- Modify: `docs/开发进度.md`

1. Run targeted ESLint and `pnpm typecheck`.
2. Run affected unit/integration/E2E suites and `pnpm build`.
3. Run `git diff --check` and inspect the complete diff against base `4d12b1f`.
4. Record the completed checkpoint, exact tests, PR #58 dependency, and production `NO-GO` in `docs/开发进度.md`.
