import { describe, expect, it } from 'vitest'

import { createValidationPlan } from '../../scripts/ci/plan-validation.mjs'

const docs = {
  admin_e2e: false,
  chat_e2e: false,
  code: false,
  database: false,
  docs_only: true,
  full_fallback: false,
  inquiry_e2e: false,
  operations: false,
  production_image: false,
  website_e2e: false,
  website_visual_e2e: false,
}

describe('CI validation planner', () => {
  it('keeps documentation changes on the lightweight path', () => {
    expect(
      createValidationPlan({ classification: docs, eventName: 'pull_request', isDraft: false }),
    ).toEqual({
      buildRequired: false,
      databaseRequired: false,
      e2eRequired: false,
      fastRequired: false,
      heavyRequired: false,
      mode: 'docs-only',
      operationsRequired: false,
      readyOrMain: true,
    })
  })

  it('runs only Fast CI for Draft code', () => {
    expect(
      createValidationPlan({
        classification: { ...docs, code: true, docs_only: false, website_e2e: true },
        eventName: 'pull_request',
        isDraft: true,
      }),
    ).toMatchObject({
      buildRequired: false,
      databaseRequired: false,
      e2eRequired: false,
      fastRequired: true,
      mode: 'fast-only',
      readyOrMain: false,
    })
  })

  it('starts database, build, and E2E only for a Ready browser change', () => {
    expect(
      createValidationPlan({
        classification: { ...docs, code: true, docs_only: false, inquiry_e2e: true },
        eventName: 'pull_request',
        isDraft: false,
      }),
    ).toMatchObject({
      buildRequired: true,
      databaseRequired: true,
      e2eRequired: true,
      fastRequired: true,
      mode: 'full-policy',
      operationsRequired: false,
    })
  })

  it('does not start database for operations-only changes', () => {
    expect(
      createValidationPlan({
        classification: { ...docs, code: true, docs_only: false, operations: true },
        eventName: 'push',
        isDraft: false,
      }),
    ).toMatchObject({
      buildRequired: false,
      databaseRequired: false,
      e2eRequired: false,
      operationsRequired: true,
    })
  })

  it('forces every heavy stage for a Draft CI control-plane change', () => {
    expect(
      createValidationPlan({
        classification: {
          admin_e2e: true,
          chat_e2e: true,
          code: true,
          database: true,
          docs_only: false,
          full_fallback: true,
          inquiry_e2e: true,
          operations: true,
          production_image: true,
          website_e2e: true,
          website_visual_e2e: true,
        },
        eventName: 'pull_request',
        forceFull: true,
        isDraft: true,
      }),
    ).toMatchObject({
      buildRequired: true,
      databaseRequired: true,
      e2eRequired: true,
      fastRequired: true,
      mode: 'full-policy',
      operationsRequired: true,
      readyOrMain: true,
    })
  })

  it('rejects forced execution without a full fallback classification', () => {
    expect(() =>
      createValidationPlan({
        classification: { ...docs, code: true, docs_only: false },
        eventName: 'pull_request',
        forceFull: true,
        isDraft: true,
      }),
    ).toThrow('forceFull requires full_fallback')
  })

  it('rejects malformed event state and classifications', () => {
    expect(() =>
      createValidationPlan({ classification: docs, eventName: 'push', isDraft: true }),
    ).toThrow('push events cannot be Draft')
    expect(() =>
      createValidationPlan({ classification: null, eventName: 'pull_request', isDraft: false }),
    ).toThrow('classification is missing or invalid')
  })
})
