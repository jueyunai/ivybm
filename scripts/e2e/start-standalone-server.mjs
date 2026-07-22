import { access, cp, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const projectRoot = process.cwd()
const standaloneDirectory = path.join(projectRoot, '.next', 'standalone')
const standaloneServer = path.join(standaloneDirectory, 'server.js')
const staticSource = path.join(projectRoot, '.next', 'static')
const staticTarget = path.join(standaloneDirectory, '.next', 'static')
const publicSource = path.join(projectRoot, 'public')
const publicTarget = path.join(standaloneDirectory, 'public')

const assertReadableDirectory = async (directory, description) => {
  try {
    await access(directory)
  } catch {
    throw new Error(`${description} is missing. Run \"pnpm build\" before starting the E2E server.`)
  }
}

const copyRuntimeAssets = async () => {
  await assertReadableDirectory(standaloneServer, 'Standalone server output')
  await assertReadableDirectory(staticSource, 'Next.js static output')

  await rm(staticTarget, { force: true, recursive: true })
  await cp(staticSource, staticTarget, { recursive: true })

  await rm(publicTarget, { force: true, recursive: true })

  try {
    await access(publicSource)
  } catch {
    // A public directory is optional. Clear any stale copied assets either way.
    return
  }

  await cp(publicSource, publicTarget, { recursive: true })
}

await copyRuntimeAssets()

const child = spawn(process.execPath, [standaloneServer], {
  env: {
    ...process.env,
    HOSTNAME: process.env.HOSTNAME || '127.0.0.1',
    PORT: process.env.PORT || '3000',
  },
  stdio: 'inherit',
})

let forwardedSignal

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    forwardedSignal = signal

    if (!child.killed) child.kill(signal)
  })
}

child.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  if (signal && signal !== forwardedSignal) {
    process.exitCode = 1
    return
  }

  process.exitCode = code ?? 0
})
