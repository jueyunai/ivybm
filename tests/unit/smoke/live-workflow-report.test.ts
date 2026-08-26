import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  determineOverallStatus,
  determineScenarioStatus,
  HONEST_RESIDUE_NOTE,
  maskSmokeIdentifier,
  SmokeReportBuilder,
} from '../../../scripts/smoke/report'

describe('live-workflow report logic', () => {
  it('determines scenario status with correct precedence', () => {
    expect(determineScenarioStatus(['PASS', 'PASS'])).toBe('PASS')
    expect(determineScenarioStatus(['PASS', 'FAIL_WEBSITE'])).toBe('FAIL_WEBSITE')
    expect(determineScenarioStatus(['FAIL_WEBSITE', 'FAIL_FEISHU'])).toBe('FAIL_WEBSITE')
    expect(determineScenarioStatus(['PASS', 'BLOCKED_PORTAL_AUTH'])).toBe('BLOCKED_PORTAL_AUTH')
    expect(determineScenarioStatus(['FAIL_FEISHU', 'BLOCKED_FEISHU_UI'])).toBe('BLOCKED_FEISHU_UI')
  })

  it('determines overall status including cleanup failures', () => {
    expect(determineOverallStatus('PASS', 'PASS', 'SUCCESS')).toBe('PASS')
    expect(determineOverallStatus('PASS', 'PASS', 'FAILED')).toBe('CLEANUP_FAILED')
    expect(determineOverallStatus('FAIL_PORTAL', 'PASS', 'FAILED')).toBe('FAIL_PORTAL')
    expect(determineOverallStatus('BLOCKED_PORTAL_AUTH', undefined, 'SUCCESS')).toBe(
      'BLOCKED_PORTAL_AUTH',
    )
  })

  it('builds, saves, and formats report correctly', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'smoke-report-test-'))
    try {
      const builder = new SmokeReportBuilder({
        locales: ['en', 'ar'],
        outputDir: tempDir,
        runId: 'canary-test-run-123',
        targetUrl: 'https://staging.example.invalid',
      })

      builder.addInquiryRun({
        durationMs: 4500,
        feishuFound: true,
        locale: 'en',
        requestId: 'req-en-123',
        screenshots: {
          feishu: join(tempDir, 'inquiry-feishu-en.png'),
          portalLead: join(tempDir, 'inquiry-portal-lead-en.png'),
          website: join(tempDir, 'inquiry-website-en.png'),
        },
        status: 'PASS',
      })

      builder.addInquiryRun({
        durationMs: 5000,
        feishuFound: true,
        locale: 'ar',
        requestId: 'req-ar-456',
        screenshots: {
          feishu: join(tempDir, 'inquiry-feishu-ar.png'),
          portalLead: join(tempDir, 'inquiry-portal-lead-ar.png'),
          website: join(tempDir, 'inquiry-website-ar.png'),
        },
        status: 'PASS',
      })

      builder.addChatRun({
        conversationResolved: true,
        durationMs: 12000,
        feishuFound: true,
        locale: 'en',
        operatorReplyReceived: true,
        requestId: 'req-chat-en',
        screenshots: {
          feishu: join(tempDir, 'chat-feishu-en.png'),
          portalConversation: join(tempDir, 'chat-portal-conv-en.png'),
          portalLead: join(tempDir, 'chat-portal-lead-en.png'),
          visitor: join(tempDir, 'chat-visitor-en.png'),
        },
        sessionId: 'session-en-789',
        status: 'PASS',
      })

      builder.setCleanup({
        details: ['Resolved test conversation', 'Archived canary lead'],
        status: 'SUCCESS',
      })

      const report = builder.build()
      expect(report.overallStatus).toBe('PASS')
      expect(report.runId).toBe('canary-test-run-123')
      expect(report.scenarios.inquiry?.status).toBe('PASS')
      expect(report.scenarios.inquiry?.runs).toHaveLength(2)
      expect(report.scenarios.chat?.status).toBe('PASS')
      expect(report.scenarios.chat?.runs).toHaveLength(1)
      expect(report.honestResidueNote).toBe(HONEST_RESIDUE_NOTE)

      const reportPath = await builder.saveArtifacts()
      const savedContent = JSON.parse(await readFile(reportPath, 'utf-8'))
      expect(savedContent.runId).toBe('canary-test-run-123')
      expect(savedContent.overallStatus).toBe('PASS')
      expect(savedContent.evidence).toEqual([])

      const summary = builder.formatSummary()
      expect(summary).toContain('LIVE WORKFLOW SMOKE REPORT')
      expect(summary).toContain('canary-test-run-123')
      expect(summary).toContain('Overall Status: PASS')
      expect(summary).toContain('[CAN-INQ-01 Inquiry Workflow] Status: PASS')
      expect(summary).toContain('[CAN-CHAT-01 Chat & Handoff Workflow] Status: PASS')
      expect(summary).toContain(maskSmokeIdentifier('req-en-123'))
      expect(summary).toContain(maskSmokeIdentifier('session-en-789'))
      expect(summary).not.toContain('req-en-123')
      expect(summary).not.toContain('session-en-789')
      expect(JSON.stringify(savedContent)).not.toContain('req-en-123')
      expect(JSON.stringify(savedContent)).not.toContain('session-en-789')
    } finally {
      await rm(tempDir, { force: true, recursive: true }).catch(() => undefined)
    }
  })
})
