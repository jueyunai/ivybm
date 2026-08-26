import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { determineChatStatus } from '../../../scripts/smoke/chat-workflow'
import type { SmokeConfig } from '../../../scripts/smoke/config'
import { runLiveWorkflowSmoke } from '../../../scripts/smoke/live-workflow-smoke'

describe('live-workflow runner logic', () => {
  const tempDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    )
  })

  it('maps missing operator delivery or resolution to a non-PASS status', () => {
    expect(
      determineChatStatus({
        conversationResolved: true,
        feishuStatus: 'PASS',
        operatorReplyReceived: false,
      }),
    ).toBe('FAIL_WEBSITE')
    expect(
      determineChatStatus({
        conversationResolved: false,
        feishuStatus: 'PASS',
        operatorReplyReceived: true,
      }),
    ).toBe('FAIL_PORTAL')
  })

  it('propagates browser initialization errors instead of reporting cleanup failure', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'smoke-runner-unit-'))
    tempDirectories.push(outputDir)
    const config: SmokeConfig = {
      evidenceMode: 'compact',
      feishuTableUrl: 'https://example.invalid/feishu',
      headless: true,
      locales: ['en'],
      outputDir,
      portalEmail: 'smoke@example.invalid',
      portalPassword: 'secret-password-123',
      scenario: 'inquiry',
      targetUrl: 'http://127.0.0.1:3000',
      timeoutMs: 10_000,
    }

    await expect(
      runLiveWorkflowSmoke(config, 'canary-test-browser-init', {
        launchBrowser: async () => {
          throw new Error('Synthetic browser launch failed')
        },
      }),
    ).rejects.toThrow('Synthetic browser launch failed')
  })
})
