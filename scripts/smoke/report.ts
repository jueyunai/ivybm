import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SmokeLocale } from './config'

export type SmokeStatus =
  | 'PASS'
  | 'FAIL_WEBSITE'
  | 'FAIL_AI'
  | 'FAIL_PORTAL'
  | 'FAIL_FEISHU'
  | 'BLOCKED_PORTAL_AUTH'
  | 'BLOCKED_FEISHU_UI'
  | 'CLEANUP_FAILED'

export type SmokeStage = 'ai' | 'feishu' | 'portal' | 'website'

export type InquiryRunResult = {
  durationMs: number
  error?: string
  feishuFound?: boolean
  leadId?: number | string
  locale: SmokeLocale
  requestId?: string
  screenshots: Record<string, string>
  status: SmokeStatus
}

export type ChatRunResult = {
  cleanup?: CleanupResult
  conversationResolved?: boolean
  durationMs: number
  error?: string
  feishuFound?: boolean
  leadId?: number | string
  locale: SmokeLocale
  operatorReplyReceived?: boolean
  requestId?: string
  screenshots: Record<string, string>
  sessionId?: string
  status: SmokeStatus
}

export type CleanupResult = {
  details: string[]
  screenshots?: string[]
  status: 'FAILED' | 'SKIPPED' | 'SUCCESS'
}

export type SmokeReport = {
  cleanup: CleanupResult
  durationMs: number
  evidence: string[]
  finishedAt: string
  honestResidueNote: string
  locales: SmokeLocale[]
  overallStatus: SmokeStatus
  runId: string
  scenarios: {
    chat?: {
      durationMs: number
      runs: ChatRunResult[]
      status: SmokeStatus
    }
    inquiry?: {
      durationMs: number
      runs: InquiryRunResult[]
      status: SmokeStatus
    }
  }
  startedAt: string
  targetUrl: string
}

export const HONEST_RESIDUE_NOTE =
  'Production workflow smoke creates immutable conversation records, jobs, audit entries, and non-recallable Feishu notifications. Synthetic records contain [CANARY <runId>] for identification and manual archival.'

export const maskSmokeIdentifier = (value: string): string => `…${value.slice(-6)}`

const maskErrorIdentifiers = (
  error: string | undefined,
  identifiers: Array<string | undefined>,
): string | undefined => {
  if (!error) return undefined
  return identifiers.reduce((masked: string, identifier) => {
    return identifier ? masked.replaceAll(identifier, maskSmokeIdentifier(identifier)) : masked
  }, error)
}

export const determineScenarioStatus = (statuses: SmokeStatus[]): SmokeStatus => {
  if (statuses.length === 0) return 'PASS'
  for (const blocked of ['BLOCKED_PORTAL_AUTH', 'BLOCKED_FEISHU_UI'] as const) {
    if (statuses.includes(blocked)) return blocked
  }
  for (const failed of ['FAIL_WEBSITE', 'FAIL_AI', 'FAIL_PORTAL', 'FAIL_FEISHU'] as const) {
    if (statuses.includes(failed)) return failed
  }
  if (statuses.includes('CLEANUP_FAILED')) return 'CLEANUP_FAILED'
  return 'PASS'
}

export const determineOverallStatus = (
  inquiryStatus?: SmokeStatus,
  chatStatus?: SmokeStatus,
  cleanupStatus?: CleanupResult['status'],
): SmokeStatus => {
  const activeStatuses = [inquiryStatus, chatStatus].filter((s): s is SmokeStatus => Boolean(s))
  const primaryStatus = determineScenarioStatus(activeStatuses)
  if (primaryStatus === 'PASS' && cleanupStatus === 'FAILED') {
    return 'CLEANUP_FAILED'
  }
  return primaryStatus
}

export class SmokeReportBuilder {
  private readonly runId: string
  private readonly targetUrl: string
  private readonly locales: SmokeLocale[]
  private readonly outputDir: string
  private readonly startedAt: Date
  private finishedAt?: Date
  private inquiryRuns: InquiryRunResult[] = []
  private chatRuns: ChatRunResult[] = []
  private cleanupResult: CleanupResult = { details: [], status: 'SKIPPED' }
  private evidenceFiles: string[] = []

  constructor({
    locales,
    outputDir,
    runId,
    targetUrl,
  }: {
    locales: SmokeLocale[]
    outputDir: string
    runId: string
    targetUrl: string
  }) {
    this.runId = runId
    this.targetUrl = targetUrl
    this.locales = locales
    this.outputDir = outputDir
    this.startedAt = new Date()
  }

  addInquiryRun(result: InquiryRunResult): void {
    const maskedResult = {
      ...result,
      error: maskErrorIdentifiers(result.error, [result.requestId]),
      requestId: result.requestId ? maskSmokeIdentifier(result.requestId) : undefined,
    }
    this.inquiryRuns.push(maskedResult)
    for (const path of Object.values(maskedResult.screenshots)) {
      this.evidenceFiles.push(path)
    }
  }

  addChatRun(result: ChatRunResult): void {
    const maskedResult = {
      ...result,
      error: maskErrorIdentifiers(result.error, [result.requestId, result.sessionId]),
      requestId: result.requestId ? maskSmokeIdentifier(result.requestId) : undefined,
      sessionId: result.sessionId ? maskSmokeIdentifier(result.sessionId) : undefined,
    }
    this.chatRuns.push(maskedResult)
    for (const path of Object.values(maskedResult.screenshots)) {
      this.evidenceFiles.push(path)
    }
  }

  setCleanup(result: CleanupResult): void {
    this.cleanupResult = result
    for (const path of result.screenshots ?? []) this.evidenceFiles.push(path)
  }

  build(): SmokeReport {
    this.finishedAt = this.finishedAt ?? new Date()
    const durationMs = this.finishedAt.getTime() - this.startedAt.getTime()

    const inquiryStatus =
      this.inquiryRuns.length > 0
        ? determineScenarioStatus(this.inquiryRuns.map((r) => r.status))
        : undefined

    const chatStatus =
      this.chatRuns.length > 0
        ? determineScenarioStatus(this.chatRuns.map((r) => r.status))
        : undefined

    const overallStatus = determineOverallStatus(
      inquiryStatus,
      chatStatus,
      this.cleanupResult.status,
    )

    const inquiryDurationMs = this.inquiryRuns.reduce((acc, r) => acc + r.durationMs, 0)
    const chatDurationMs = this.chatRuns.reduce((acc, r) => acc + r.durationMs, 0)

    return {
      cleanup: this.cleanupResult,
      durationMs,
      evidence: Array.from(new Set(this.evidenceFiles)),
      finishedAt: this.finishedAt.toISOString(),
      honestResidueNote: HONEST_RESIDUE_NOTE,
      locales: this.locales,
      overallStatus,
      runId: this.runId,
      scenarios: {
        ...(inquiryStatus
          ? {
              inquiry: {
                durationMs: inquiryDurationMs,
                runs: this.inquiryRuns,
                status: inquiryStatus,
              },
            }
          : {}),
        ...(chatStatus
          ? {
              chat: {
                durationMs: chatDurationMs,
                runs: this.chatRuns,
                status: chatStatus,
              },
            }
          : {}),
      },
      startedAt: this.startedAt.toISOString(),
      targetUrl: this.targetUrl,
    }
  }

  async saveArtifacts(): Promise<string> {
    const existingEvidence: string[] = []
    for (const path of this.evidenceFiles) {
      if (
        await access(path)
          .then(() => true)
          .catch(() => false)
      ) {
        existingEvidence.push(path)
      }
    }
    this.evidenceFiles = existingEvidence
    const report = this.build()
    const runDir = join(this.outputDir, this.runId)
    await mkdir(runDir, { recursive: true })
    const reportPath = join(runDir, 'report.json')
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8')
    return reportPath
  }

  formatSummary(): string {
    const report = this.build()
    const lines: string[] = [
      `=== LIVE WORKFLOW SMOKE REPORT ===`,
      `Run ID: ${report.runId}`,
      `Target URL: ${report.targetUrl}`,
      `Overall Status: ${report.overallStatus}`,
      `Duration: ${(report.durationMs / 1000).toFixed(2)}s`,
      `Locales: ${report.locales.join(', ')}`,
      ``,
    ]

    if (report.scenarios.inquiry) {
      lines.push(`[CAN-INQ-01 Inquiry Workflow] Status: ${report.scenarios.inquiry.status}`)
      for (const run of report.scenarios.inquiry.runs) {
        lines.push(
          `  - Locale ${run.locale.toUpperCase()}: ${run.status} (${(run.durationMs / 1000).toFixed(2)}s)` +
            (run.requestId ? ` | Request ID: ${run.requestId}` : '') +
            (run.error ? ` | Error: ${run.error}` : ''),
        )
      }
      lines.push(``)
    }

    if (report.scenarios.chat) {
      lines.push(`[CAN-CHAT-01 Chat & Handoff Workflow] Status: ${report.scenarios.chat.status}`)
      for (const run of report.scenarios.chat.runs) {
        lines.push(
          `  - Locale ${run.locale.toUpperCase()}: ${run.status} (${(run.durationMs / 1000).toFixed(2)}s)` +
            (run.sessionId ? ` | Session ID: ${run.sessionId}` : '') +
            (run.error ? ` | Error: ${run.error}` : ''),
        )
      }
      lines.push(``)
    }

    lines.push(`Cleanup: ${report.cleanup.status} (${report.cleanup.details.join('; ') || 'None'})`)
    lines.push(`Evidence: ${report.evidence.length} screenshots saved`)
    lines.push(`Note: ${report.honestResidueNote}`)
    lines.push(`==================================`)

    return lines.join('\n')
  }
}
