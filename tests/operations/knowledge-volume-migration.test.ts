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
  exec)
    if [[ -e "$root/fail-exec" ]]; then
      exit 125
    fi
    container="$2"
    shift 2
    if [[ "$1" == 'test' && "$2" == '-d' ]]; then
      dir="$3"
      case "$container:$dir" in
        old-app:/app/private/knowledge-sources)
          if [[ -d "$root/old-app/sources" ]]; then
            exit 0
          else
            exit 1
          fi
          ;;
        old-worker:/app/private/knowledge-source-assets)
          if [[ -d "$root/old-worker/assets" ]]; then
            exit 0
          else
            exit 1
          fi
          ;;
        *) exit 1 ;;
      esac
    fi
    exit 64
    ;;
  volume)
    action="$2"
    case "$action" in
      inspect)
        volume="\${@: -1}"
        [[ -d "$root/volumes/$volume" ]]
        ;;
      create)
        volume="\${@: -1}"
        [[ "$volume" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]]
        mkdir -p "$root/volumes/$volume"
        printf '%s\n' "$volume"
        ;;
      rm)
        shift 2
        for v in "$@"; do
          rm -rf "$root/volumes/$v"
          printf '%s\n' "$v"
        done
        ;;
      *) exit 64 ;;
    esac
    ;;
  ps)
    if [[ -e "$root/volume-attached" ]]; then
      printf 'new-app-container\n'
    fi
    ;;
  cp)
    source="$2"
    destination="$3"
    case "$source" in
      old-app:/app/private/knowledge-sources/.)
        if [[ -e "$root/fail-sources-cp" ]]; then
          exit 1
        fi
        if [[ -d "$root/old-app/sources" ]]; then
          cp -a "$root/old-app/sources/." "$destination"
        else
          exit 1
        fi
        ;;
      old-worker:/app/private/knowledge-source-assets/.)
        if [[ -e "$root/fail-assets-cp" ]]; then
          exit 1
        fi
        if [[ -d "$root/old-worker/assets" ]]; then
          cp -a "$root/old-worker/assets/." "$destination"
        else
          exit 1
        fi
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
      if [[ -e "$root/fail-target-assets-copy" && ! -e "$root/target-assets-failed" && "$target_volume" == ivybm-prod-knowledge-source-assets ]]; then
        touch "$root/target-assets-failed"
        exit 42
      fi
      if [[ -d "$root/volumes/$source_path" ]]; then
        source_dir="$root/volumes/$source_path"
      else
        source_dir="$source_path"
      fi
      cp -a "$source_dir/." "$volume_path/"
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

  const run = (options: string[] = []) =>
    spawnSync(
      'bash',
      [
        './scripts/migrate-production-knowledge-volumes.sh',
        ...options,
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
    expect(log).toContain('exec old-app test -d /app/private/knowledge-sources')
    expect(log).toContain('exec old-worker test -d /app/private/knowledge-source-assets')
    expect(log).toContain('cp old-app:/app/private/knowledge-sources/.')
    expect(log).toContain('cp old-worker:/app/private/knowledge-source-assets/.')
    expect(log).toContain('chown\\ -R\\ 1001:1001')
    expect(log).toContain('stat\\ -c\\ %u:%g\\ /target')
    expect(log).not.toMatch(/\{RANDOM\}/)
    expect(log).toMatch(/volume create ivybm-prod-knowledge-sources-stage-[0-9]+-[0-9]+/)
    expect(log).toMatch(/volume create ivybm-prod-knowledge-source-assets-stage-[0-9]+-[0-9]+/)
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

  it('removes only newly created staging volumes when an import fails so the migration can retry', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'fail-assets-copy'), '')

    const result = run()

    expect(result.status).toBe(42)
    expect(existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources'))).toBe(false)
    expect(existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets'))).toBe(
      false,
    )
    const log = readFileSync(resolve(directory, 'docker.log'), 'utf8')
    expect(log).toMatch(/volume rm ivybm-prod-knowledge-sources-stage-/)
    expect(log).toMatch(/volume rm ivybm-prod-knowledge-source-assets-stage-/)
  })

  it('restores existing volumes when replacement import fails after the switch starts', () => {
    const { directory, run } = createHarness()
    const sourcesVolume = resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources')
    const assetsVolume = resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets')
    mkdirSync(sourcesVolume, { recursive: true })
    mkdirSync(assetsVolume, { recursive: true })
    writeFileSync(resolve(sourcesVolume, 'existing.pdf'), 'existing-source')
    writeFileSync(resolve(assetsVolume, 'existing.png'), 'existing-asset')
    writeFileSync(resolve(directory, 'fail-target-assets-copy'), '')

    const failedResult = run(['--replace-unattached'])

    expect(failedResult.status).toBe(42)
    expect(readFileSync(resolve(sourcesVolume, 'existing.pdf'), 'utf8')).toBe('existing-source')
    expect(readFileSync(resolve(assetsVolume, 'existing.png'), 'utf8')).toBe('existing-asset')
    const failedLog = readFileSync(resolve(directory, 'docker.log'), 'utf8')
    expect(failedLog).toMatch(/volume rm ivybm-prod-knowledge-sources-stage-/)
    expect(failedLog).toMatch(/volume rm ivybm-prod-knowledge-source-assets-stage-/)
    expect(failedResult.stderr).toContain(
      'Migration switch failed; existing volumes were restored from backup.',
    )
    expect(failedResult.stderr).toContain('Retained recovery backups')
    expect(failedLog).toMatch(/volume create ivybm-prod-knowledge-sources-backup-/)
    expect(failedLog).toMatch(/volume create ivybm-prod-knowledge-source-assets-backup-/)

    rmSync(resolve(directory, 'fail-target-assets-copy'))
    const retryResult = run(['--replace-unattached'])

    expect(retryResult.status).toBe(0)
    expect(existsSync(resolve(sourcesVolume, 'source.pdf'))).toBe(true)
    expect(existsSync(resolve(assetsVolume, 'asset.png'))).toBe(true)
    expect(existsSync(resolve(sourcesVolume, 'existing.pdf'))).toBe(false)
    expect(existsSync(resolve(assetsVolume, 'existing.png'))).toBe(false)
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

  it('preserves unreferenced legacy files from old containers while validating database references', () => {
    const { directory, run } = createHarness()
    writeFileSync(
      resolve(directory, 'old-app', 'sources', 'unreferenced.pdf'),
      'unreferenced-source',
    )
    writeFileSync(
      resolve(directory, 'old-worker', 'assets', 'unreferenced.png'),
      'unreferenced-asset',
    )

    const result = run()

    expect(result.status).toBe(0)
    expect(
      existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources', 'source.pdf')),
    ).toBe(true)
    expect(
      existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources', 'unreferenced.pdf')),
    ).toBe(true)
    expect(
      existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets', 'asset.png')),
    ).toBe(true)
    expect(
      existsSync(
        resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets', 'unreferenced.png'),
      ),
    ).toBe(true)
    expect(
      readFileSync(
        resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources', 'unreferenced.pdf'),
        'utf8',
      ),
    ).toBe('unreferenced-source')
    expect(
      readFileSync(
        resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets', 'unreferenced.png'),
        'utf8',
      ),
    ).toBe('unreferenced-asset')
  })

  it('exports and preserves legacy files even when database manifests are empty', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'expected-sources'), '')
    writeFileSync(resolve(directory, 'expected-assets'), '')
    writeFileSync(resolve(directory, 'old-app', 'sources', 'orphan.pdf'), 'orphan-source')
    writeFileSync(resolve(directory, 'old-worker', 'assets', 'orphan.png'), 'orphan-asset')

    const result = run()

    expect(result.status).toBe(0)
    expect(
      existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources', 'orphan.pdf')),
    ).toBe(true)
    expect(
      existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets', 'orphan.png')),
    ).toBe(true)
    expect(
      readFileSync(
        resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources', 'orphan.pdf'),
        'utf8',
      ),
    ).toBe('orphan-source')
    expect(
      readFileSync(
        resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets', 'orphan.png'),
        'utf8',
      ),
    ).toBe('orphan-asset')
  })

  it('allows a missing legacy worker assets directory only when the asset manifest is empty', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'expected-assets'), '')
    rmSync(resolve(directory, 'old-worker', 'assets'), { recursive: true })

    const result = run()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'Legacy knowledge source assets directory is missing from old-worker, and database manifest is empty; proceeding with empty directory.',
    )
  })

  it('allows a missing legacy app source directory only when the source manifest is empty', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'expected-sources'), '')
    rmSync(resolve(directory, 'old-app', 'sources'), { recursive: true })

    const result = run()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'Legacy knowledge sources directory is missing from old-app, and database manifest is empty; proceeding with empty directory.',
    )
  })

  it('fails when legacy sources directory exists but docker cp fails even if database manifest is empty', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'expected-sources'), '')
    writeFileSync(resolve(directory, 'fail-sources-cp'), '')

    const result = run()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Failed to export legacy knowledge sources directory')
    expect(existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources'))).toBe(false)
  })

  it('fails when legacy assets directory exists but docker cp fails even if database manifest is empty', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'expected-assets'), '')
    writeFileSync(resolve(directory, 'fail-assets-cp'), '')

    const result = run()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Failed to export legacy knowledge source assets directory')
    expect(existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets'))).toBe(
      false,
    )
  })

  it('fails when docker exec directory inspection fails', () => {
    const { directory, run } = createHarness()
    writeFileSync(resolve(directory, 'expected-sources'), '')
    writeFileSync(resolve(directory, 'fail-exec'), '')

    const result = run()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Failed to inspect legacy knowledge sources directory')
    expect(existsSync(resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources'))).toBe(false)
  })

  it('replaces unattached migration volumes on an explicit pre-deploy retry', () => {
    const { directory, run } = createHarness()
    const sourcesVolume = resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources')
    const assetsVolume = resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets')
    mkdirSync(sourcesVolume, { recursive: true })
    mkdirSync(assetsVolume, { recursive: true })
    writeFileSync(resolve(sourcesVolume, 'stale.pdf'), 'stale')
    writeFileSync(resolve(assetsVolume, 'stale.png'), 'stale')

    const result = run(['--replace-unattached'])

    expect(result.status).toBe(0)
    expect(existsSync(resolve(sourcesVolume, 'source.pdf'))).toBe(true)
    expect(existsSync(resolve(assetsVolume, 'asset.png'))).toBe(true)
    expect(existsSync(resolve(sourcesVolume, 'stale.pdf'))).toBe(false)
    expect(existsSync(resolve(assetsVolume, 'stale.png'))).toBe(false)
  })

  it('never overwrites an existing migration volume without the explicit retry option', () => {
    const { directory, run } = createHarness()
    const sourcesVolume = resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources')
    mkdirSync(sourcesVolume, { recursive: true })
    writeFileSync(resolve(sourcesVolume, 'existing.pdf'), 'existing')

    const result = run()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Refusing to overwrite existing volume')
    expect(existsSync(resolve(sourcesVolume, 'existing.pdf'))).toBe(true)
  })

  it('refuses to replace a migration volume referenced by any container', () => {
    const { directory, run } = createHarness()
    const sourcesVolume = resolve(directory, 'volumes', 'ivybm-prod-knowledge-sources')
    const assetsVolume = resolve(directory, 'volumes', 'ivybm-prod-knowledge-source-assets')
    mkdirSync(sourcesVolume, { recursive: true })
    mkdirSync(assetsVolume, { recursive: true })
    writeFileSync(resolve(sourcesVolume, 'stale.pdf'), 'stale')
    writeFileSync(resolve(directory, 'volume-attached'), '')

    const result = run(['--replace-unattached'])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Refusing to replace volume referenced by a container')
    expect(existsSync(resolve(sourcesVolume, 'stale.pdf'))).toBe(true)
    expect(existsSync(assetsVolume)).toBe(true)
  })
})
