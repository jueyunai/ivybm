import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temporaryDirectories: string[] = []

const encodeFilename = (filename: string): string => Buffer.from(filename).toString('base64')

const createHarness = () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'ivybm-knowledge-volume-migration-'))
  temporaryDirectories.push(directory)
  mkdirSync(resolve(directory, 'old-app', 'sources'), { recursive: true })
  mkdirSync(resolve(directory, 'old-worker', 'assets'), { recursive: true })
  mkdirSync(resolve(directory, 'volumes'), { recursive: true })
  writeFileSync(resolve(directory, 'old-app', 'sources', 'source.pdf'), 'source')
  writeFileSync(resolve(directory, 'old-worker', 'assets', 'asset.png'), 'asset')
  writeFileSync(resolve(directory, 'expected-sources'), `${encodeFilename('source.pdf')}\n`)
  writeFileSync(resolve(directory, 'expected-assets'), `${encodeFilename('asset.png')}\n`)
  writeFileSync(resolve(directory, '.env'), 'POSTGRES_USER=ivybm\nPOSTGRES_DB=ivybm\n')

  const fakeDocker = resolve(directory, 'docker')
  writeFileSync(
    fakeDocker,
    `#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
printf '%q ' "$@" >>"$root/docker.log"
printf '\n' >>"$root/docker.log"

case "\${1-}" in
  inspect)
    if [[ "\${2-}" == '-f' ]]; then
      container="\${@: -1}"
      if [[ "$container" == 'old-worker' && -e "$root/worker-running" ]]; then
        printf 'true\n'
      else
        printf 'false\n'
      fi
    else
      [[ "\${2-}" == 'old-app' || "\${2-}" == 'old-worker' ]]
    fi
    ;;
  volume)
    action="$2"
    volume="\${@: -1}"
    case "$action" in
      inspect) [[ -d "$root/volumes/$volume" ]] ;;
      create) mkdir -p "$root/volumes/$volume"; printf '%s\n' "$volume" ;;
      rm) rm -rf "$root/volumes/$volume"; printf '%s\n' "$volume" ;;
      *) exit 64 ;;
    esac
    ;;
  cp)
    source="$2"
    destination="$3"
    case "$source" in
      old-app:/app/private/knowledge-sources/.)
        cp -a "$root/old-app/sources/." "$destination"
        ;;
      old-worker:/app/private/knowledge-source-assets/.)
        cp -a "$root/old-worker/assets/." "$destination"
        ;;
      *) exit 65 ;;
    esac
    ;;
  compose)
    arguments="$*"
    if [[ "$arguments" == *knowledge_source_documents* ]]; then
      cat "$root/expected-sources"
    elif [[ "$arguments" == *knowledge_source_assets* ]]; then
      cat "$root/expected-assets"
    else
      exit 64
    fi
    ;;
  run)
    shift
    target_volume=''
    source_path=''
    expected_path=''
    while (($#)); do
      if [[ "$1" == '-v' ]]; then
        mount="$2"
        host="\${mount%%:*}"
        remainder="\${mount#*:}"
        target="/\${remainder#*/}"
        target="\${target%%:*}"
        case "$target" in
          /target) target_volume="$host" ;;
          /source) source_path="$host" ;;
          /expected) expected_path="$host" ;;
        esac
        shift 2
      else
        shift
      fi
    done
    [[ -n "$target_volume" ]]
    volume_path="$root/volumes/$target_volume"
    if [[ -n "$source_path" ]]; then
      if [[ -e "$root/fail-assets-copy" && "$source_path" == */assets ]]; then
        exit 42
      fi
      cp -a "$source_path/." "$volume_path/"
    elif [[ -n "$expected_path" ]]; then
      while IFS= read -r filename; do
        [[ -z "$filename" || -f "$volume_path/$filename" ]]
      done <"$expected_path"
    else
      exit 64
    fi
    ;;
  *) exit 64 ;;
esac
`,
  )
  chmodSync(fakeDocker, 0o755)

  const run = () =>
    spawnSync(
      'bash',
      [
        './scripts/migrate-production-knowledge-volumes.sh',
        resolve(directory, '.env'),
        'old-app',
        'old-worker',
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}` },
      },
    )

  return { directory, run }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('production knowledge volume migration', () => {
  it('exports every database-referenced file and verifies imported ownership', () => {
    const { directory, run } = createHarness()
    const result = run()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Migrated and verified database-referenced knowledge files')
    expect(
      existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources', 'source.pdf')),
    ).toBe(true)
    expect(
      existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets', 'asset.png')),
    ).toBe(true)
    const log = readFileSync(resolve(directory, 'docker.log'), 'utf8')
    expect(log).toContain('cp old-app:/app/private/knowledge-sources/.')
    expect(log).toContain('cp old-worker:/app/private/knowledge-source-assets/.')
    expect(log).toContain('chown\\ -R\\ 1001:1001')
    expect(log).toContain('stat\\ -c\\ %u:%g\\ /target')
  })

  it('rejects unsafe database filenames before creating volumes', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'expected-sources'), `${encodeFilename('../outside')}\n`)

    const result = run()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Unsafe filename returned by knowledge_source_documents')
    expect(existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources'))).toBe(false)
  })

  it('fails before volume creation when an exported database reference is missing', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'expected-assets'), `${encodeFilename('missing.png')}\n`)

    const result = run()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Database-referenced file is missing from export')
    expect(existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources'))).toBe(false)
  })

  it('removes only newly created volumes when an import fails so the migration can retry', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'fail-assets-copy'), '')

    const result = run()

    expect(result.status).toBe(42)
    expect(existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources'))).toBe(false)
    expect(existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets'))).toBe(
      false,
    )
    const log = readFileSync(resolve(directory, 'docker.log'), 'utf8')
    expect(log).toContain('volume rm ivybm-prod-knowledge-sources')
    expect(log).toContain('volume rm ivybm-prod-knowledge-source-assets')
  })

  it('requires both legacy containers to be stopped', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'worker-running'), '')

    const result = run()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'Stop the old container before exporting knowledge files: old-worker',
    )
    expect(existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources'))).toBe(false)
  })

  it('allows a missing legacy worker assets directory only when the asset manifest is empty', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'expected-assets'), '')
    rmSync(resolve(directory, 'old-worker', 'assets'), { recursive: true })

    const result = run()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'No database-referenced knowledge assets; skipping legacy worker asset export.',
    )
    const log = readFileSync(resolve(directory, 'docker.log'), 'utf8')
    expect(log).not.toContain('cp old-worker:/app/private/knowledge-source-assets/.')
  })
})
