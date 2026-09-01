import { getPayload } from 'payload'

import config from '@/payload.config'
import { cleanupLeadAttachments } from '@/modules/lead-attachments/cleanup'

const usage = `Usage:
  pnpm tsx scripts/lead-attachments-cleanup.ts [--dry-run] [--execute] [--retention-days <days>] [--staging-hours <hours>] [--now <iso-date>]

Options:
  --dry-run                 Simulate cleanup without deleting files or records (default: true)
  --execute                 Perform actual deletion of expired attachments and files
  --retention-days <days>   Retention threshold in days for associated attachments (default: 180)
  --staging-hours <hours>   TTL threshold in hours for unassociated staged attachments (default: 24)
  --now <iso-date>          Simulated reference date for testing
  --json                    Output result as JSON
  --help, -h                Show this help message
`

type Args = {
  dryRun: boolean
  help: boolean
  json: boolean
  now?: string
  retentionDays: number
  stagingHours: number
}

const valueAfter = (argv: string[], index: number, option: string): string => {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

const positiveInteger = (value: string, option: string): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer`)
  }
  return parsed
}

const parseArgs = (argv: string[]): Args => {
  if (argv[0] === '--') return parseArgs(argv.slice(1))
  let dryRun = true
  let help = false
  let json = false
  let now: string | undefined
  let retentionDays = 180
  let stagingHours = 24

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') help = true
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--execute') dryRun = false
    else if (arg === '--json') json = true
    else if (arg === '--now') {
      now = valueAfter(argv, index, arg)
      index += 1
    } else if (arg === '--retention-days') {
      retentionDays = positiveInteger(valueAfter(argv, index, arg), arg)
      index += 1
    } else if (arg === '--staging-hours') {
      stagingHours = positiveInteger(valueAfter(argv, index, arg), arg)
      index += 1
    } else throw new Error(`unknown option ${arg}`)
  }

  return { dryRun, help, json, now, retentionDays, stagingHours }
}

export const runCli = async (argv = process.argv.slice(2)): Promise<number> => {
  const args = parseArgs(argv)
  if (args.help) {
    process.stdout.write(usage)
    return 0
  }

  const payload = await getPayload({ config, disableOnInit: true, key: 'attachments-cleanup-cli' })
  try {
    const result = await cleanupLeadAttachments({
      dryRun: args.dryRun,
      now: args.now,
      payload,
      retentionMs: args.retentionDays * 24 * 60 * 60 * 1000,
      stagingTtlMs: args.stagingHours * 60 * 60 * 1000,
    })

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      process.stdout.write(`${result.summary}\n`)
    }

    return result.errorsCount > 0 ? 1 : 0
  } finally {
    await payload.destroy()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli()
}
