import os from 'node:os'
import path from 'node:path'

import { safeErrorMessage } from './logging'
import { importContentManifest, manifestShaFromPath } from './importer'
import { createPayloadClientFromEnv } from './payload-client'
import type { ImportMode, ImportOptions } from './types'

type CliArgs = ImportOptions & { manifestPath: string; help: boolean }

const usage = `Usage:
  pnpm content:import -- --manifest <path> --dry-run
  pnpm content:import -- --manifest <path> --batch products --execute --confirm <sha256>
  pnpm content:import -- --manifest <path> --resume <checkpoint>

Options:
  --manifest <path>       External batch manifest (required)
  --dry-run               Read and plan without POST/PATCH requests (default)
  --execute               Enable writes; requires --confirm <manifest sha256>
  --confirm <sha256>      Exact SHA-256 of the manifest file
  --batch products|projects|all
  --publish               Publish items whose manifest entry has publish=true
  --checkpoint <path>     Write an external checkpoint after each item
  --resume <path>         Resume from a matching external checkpoint
  --help
`

const valueAfter = (args: string[], index: number, option: string): string => {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

const parseArgs = (argv: string[]): CliArgs => {
  if (argv[0] === '--') return parseArgs(argv.slice(1))
  let manifestPath: string | undefined
  let mode: ImportMode = 'dry-run'
  let confirmSha: string | undefined
  let batch: ImportOptions['batch'] = 'all'
  let publish = false
  let checkpointPath: string | undefined
  let resumePath: string | undefined
  let help = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--manifest') {
      manifestPath = valueAfter(argv, index, arg)
      index += 1
    } else if (arg === '--dry-run') {
      mode = 'dry-run'
    } else if (arg === '--execute') {
      mode = 'execute'
    } else if (arg === '--confirm') {
      confirmSha = valueAfter(argv, index, arg)
      index += 1
    } else if (arg === '--batch') {
      const value = valueAfter(argv, index, arg)
      if (value !== 'products' && value !== 'projects' && value !== 'all')
        throw new Error('--batch is invalid')
      batch = value
      index += 1
    } else if (arg === '--publish') {
      publish = true
    } else if (arg === '--checkpoint') {
      checkpointPath = valueAfter(argv, index, arg)
      index += 1
    } else if (arg === '--resume') {
      resumePath = valueAfter(argv, index, arg)
      index += 1
    } else {
      throw new Error(`unknown option ${arg}`)
    }
  }
  if (help)
    return {
      manifestPath: manifestPath ?? '',
      mode,
      confirmSha,
      batch,
      publish,
      checkpointPath,
      resumePath,
      help,
    }
  if (!manifestPath) throw new Error('--manifest is required')
  if (mode === 'execute' && !confirmSha)
    throw new Error('--execute requires --confirm <manifest sha256>')
  if (mode === 'dry-run' && confirmSha) throw new Error('--confirm is only valid with --execute')
  return { manifestPath, mode, confirmSha, batch, publish, checkpointPath, resumePath, help }
}

export const runCli = async (argv: string[] = process.argv.slice(2)): Promise<number> => {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      process.stdout.write(usage)
      return 0
    }
    const manifestSha = await manifestShaFromPath(args.manifestPath)
    const checkpointPath =
      args.checkpointPath ??
      args.resumePath ??
      (args.mode === 'execute'
        ? path.join(os.tmpdir(), `ivybm-content-import-${manifestSha.slice(0, 16)}.json`)
        : undefined)
    const client = createPayloadClientFromEnv()
    if (!client.authenticated) {
      const email = process.env.PAYLOAD_IMPORT_EMAIL
      const password = process.env.PAYLOAD_IMPORT_PASSWORD
      if (!email || !password) throw new Error('Payload import credentials are required')
      await client.login(email, password)
    }
    const summary = await importContentManifest(client, args.manifestPath, {
      mode: args.mode,
      publish: args.publish,
      batch: args.batch,
      confirmSha: args.confirmSha,
      checkpointPath,
      resumePath: args.resumePath,
    })
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${safeErrorMessage(error)}\n`)
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli()
}
