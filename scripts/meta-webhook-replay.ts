import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { getPayload } from 'payload'

import config from '@/payload.config'
import { sanitizeMetaWebhookReplayFixture, replaySanitizedMetaWebhookFixture } from '@/modules/platforms/meta/replayFixture'
import { PayloadMetaWebhookReplayRepository } from '@/modules/platforms/meta/replayStorage'

const usage = (): never => {
  throw new Error(
    'Usage: pnpm meta:webhook-replay export --id=<record-id> --confirm-export=<record-id> [--output=<file>] | replay --input=<file>',
  )
}

const parseOption = (name: string): string | undefined =>
  process.argv.slice(3).find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

const command = process.argv[2]

if (command === 'replay') {
  const input = parseOption('input')
  if (!input) usage()
  const fixture = JSON.parse(await readFile(resolve(input!), 'utf8')) as unknown
  process.stdout.write(`${JSON.stringify(replaySanitizedMetaWebhookFixture(fixture), null, 2)}\n`)
} else if (command === 'export') {
  const rawId = parseOption('id')
  const id = rawId ? Number(rawId) : Number.NaN
  if (!Number.isSafeInteger(id) || id <= 0) usage()
  if (parseOption('confirm-export') !== String(id)) {
    throw new Error('Export requires --confirm-export=<record-id>')
  }
  const payload = await getPayload({ config, disableOnInit: true, key: 'meta-webhook-replay-cli' })
  try {
    const repository = new PayloadMetaWebhookReplayRepository({ payload })
    const record = await repository.read(id)
    if (!record) throw new Error('Replay record does not exist or has expired')
    const fixture = sanitizeMetaWebhookReplayFixture(JSON.parse(record.body.toString('utf8')))
    const serialized = `${JSON.stringify(fixture, null, 2)}\n`
    const output = parseOption('output')
    if (output) {
      if (output !== basename(output) || !/^[A-Za-z0-9._-]{1,120}$/u.test(output)) {
        throw new Error('Replay export output must be a safe filename without directories')
      }
      const exportDirectory = resolve(
        process.env.META_WEBHOOK_REPLAY_EXPORT_DIR || '/tmp/ivybm-meta-webhook-replay-exports',
      )
      await mkdir(exportDirectory, { mode: 0o700, recursive: true })
      const outputPath = resolve(exportDirectory, output)
      await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      process.stdout.write(`${JSON.stringify({ exported: true, output: outputPath })}\n`)
    } else {
      process.stdout.write(serialized)
    }
  } finally {
    await payload.destroy()
  }
} else {
  usage()
}
