import { readFile, writeFile } from 'node:fs/promises'

import { getPayload } from 'payload'

import config from '@/payload.config'
import {
  createFeishuLeadResyncPlan,
  executeFeishuLeadResync,
  type FeishuLeadResyncPlan,
} from '@/modules/feishu/resync'

const usage = `Usage:
  pnpm feishu:resync -- --lead-id <id> [--lead-id <id> ...] --dry-run [--plan <path>]
  pnpm feishu:resync -- --plan <path> --execute --confirm <plan-sha256> --requested-by <admin-id>

Options:
  --lead-id <id>       Explicit local Lead ID; repeat up to 50 IDs
  --dry-run            Read current Lead revisions and print a resync plan (default)
  --plan <path>        Read/write the plan JSON file
  --execute            Enqueue only the exact plan's Lead sync Jobs
  --confirm <sha256>   Exact planHash printed by dry-run
  --requested-by <id>  Numeric administrator user ID for the audit record
  --help
`

type Args = {
  confirm?: string
  dryRun: boolean
  execute: boolean
  help: boolean
  leadIds: number[]
  planPath?: string
  requestedBy?: number
}

const valueAfter = (argv: string[], index: number, option: string): string => {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

const positiveInteger = (value: string, option: string): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${option} must be a positive integer`)
  return parsed
}

const parseArgs = (argv: string[]): Args => {
  if (argv[0] === '--') return parseArgs(argv.slice(1))
  let dryRun = true
  let execute = false
  let help = false
  const leadIds: number[] = []
  let confirm: string | undefined
  let planPath: string | undefined
  let requestedBy: number | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') help = true
    else if (arg === '--lead-id') {
      leadIds.push(positiveInteger(valueAfter(argv, index, arg), arg))
      index += 1
    } else if (arg === '--dry-run') {
      dryRun = true
      execute = false
    } else if (arg === '--execute') {
      execute = true
      dryRun = false
    } else if (arg === '--plan') {
      planPath = valueAfter(argv, index, arg)
      index += 1
    } else if (arg === '--confirm') {
      confirm = valueAfter(argv, index, arg)
      index += 1
    } else if (arg === '--requested-by') {
      requestedBy = positiveInteger(valueAfter(argv, index, arg), arg)
      index += 1
    } else throw new Error(`unknown option ${arg}`)
  }
  if (help) return { confirm, dryRun, execute, help, leadIds, planPath, requestedBy }
  if (execute && (!planPath || !confirm || !requestedBy)) {
    throw new Error('--execute requires --plan, --confirm and --requested-by')
  }
  if (!execute && confirm) throw new Error('--confirm is only valid with --execute')
  if (!execute && leadIds.length === 0 && !planPath)
    throw new Error('--lead-id is required for dry-run')
  if (execute && leadIds.length > 0) throw new Error('--lead-id cannot be combined with --execute')
  return { confirm, dryRun, execute, help, leadIds, planPath, requestedBy }
}

const readPlan = async (path: string): Promise<FeishuLeadResyncPlan> =>
  JSON.parse(await readFile(path, 'utf8')) as FeishuLeadResyncPlan

export const runCli = async (argv = process.argv.slice(2)): Promise<number> => {
  const args = parseArgs(argv)
  if (args.help) {
    process.stdout.write(usage)
    return 0
  }
  const payload = await getPayload({ config, disableOnInit: true, key: 'feishu-resync-cli' })
  try {
    if (!args.execute) {
      const plan = await createFeishuLeadResyncPlan({ leadIds: args.leadIds, payload })
      const output = `${JSON.stringify(plan, null, 2)}\n`
      if (args.planPath) await writeFile(args.planPath, output, { mode: 0o600 })
      process.stdout.write(output)
      return 0
    }
    const plan = await readPlan(args.planPath as string)
    if (plan.planHash !== args.confirm) throw new Error('--confirm does not match planHash')
    const result = await executeFeishuLeadResync({
      payload,
      plan,
      requestedBy: args.requestedBy as number,
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  } finally {
    await payload.destroy()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await runCli()
