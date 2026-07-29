import { appendFileSync, readFileSync } from 'node:fs'
import { isAbsolute, posix } from 'node:path'
import { pathToFileURL } from 'node:url'

const outputKeys = [
  'docs_only',
  'code',
  'database',
  'ui_e2e',
  'operations',
  'production_image',
  'full_fallback',
]

const lightClassification = () => ({
  docs_only: true,
  code: false,
  database: false,
  ui_e2e: false,
  operations: false,
  production_image: false,
  full_fallback: false,
})

const fullClassification = () => ({
  docs_only: false,
  code: true,
  database: true,
  ui_e2e: true,
  operations: true,
  production_image: true,
  full_fallback: true,
})

const exactDocumentationPaths = new Set([
  '.env.example',
  '.env.production.example',
  '.github/CODEOWNERS',
  '.github/pull_request_template.md',
  '.gitignore',
])

const exactCodePaths = new Set([
  '.npmrc',
  '.nvmrc',
  '.prettierrc.json',
  'eslint.config.mjs',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vitest.config.mts',
  'vitest.contract.config.mts',
  'vitest.setup.ts',
])

const isDocumentationPath = (path) =>
  path.startsWith('docs/') ||
  path.startsWith('designs/') ||
  path.startsWith('deliverables/') ||
  path.startsWith('references/') ||
  exactDocumentationPaths.has(path) ||
  (!path.includes('/') && path.endsWith('.md'))

const normalizeRepositoryPath = (path) => {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\\')) {
    return null
  }

  if (isAbsolute(path) || posix.isAbsolute(path)) {
    return null
  }

  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null
  }

  const normalized = posix.normalize(path)
  if (normalized !== path || normalized.startsWith('../')) {
    return null
  }

  return normalized
}

export function classifyChangedFiles(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return fullClassification()
  }

  const normalizedPaths = paths.map(normalizeRepositoryPath)
  if (normalizedPaths.some((path) => path === null)) {
    return fullClassification()
  }

  const result = lightClassification()

  for (const path of normalizedPaths) {
    if (isDocumentationPath(path)) {
      continue
    }

    result.docs_only = false
    let recognized = false

    if (path.startsWith('.github/workflows/') || path.startsWith('scripts/ci/')) {
      result.code = true
      result.operations = true
      recognized = true
    } else if (path.startsWith('.githooks/')) {
      result.code = true
      result.operations = true
      recognized = true
    } else if (path.startsWith('tests/')) {
      result.code = true
      recognized = true

      if (path.startsWith('tests/integration/')) {
        result.database = true
      }
      if (path.startsWith('tests/e2e/')) {
        result.ui_e2e = true
      }
      if (path.startsWith('tests/operations/')) {
        result.operations = true
      }
    } else if (path.startsWith('src/')) {
      result.code = true
      result.production_image = true
      recognized = true

      if (
        path === 'src/payload.config.ts' ||
        path === 'src/payload-types.ts' ||
        path === 'src/payload-generated-schema.ts' ||
        path.startsWith('src/collections/') ||
        path.startsWith('src/fields/') ||
        path.startsWith('src/globals/') ||
        path.startsWith('src/migrations/')
      ) {
        result.database = true
      }

      if (
        path.startsWith('src/admin/') ||
        path.startsWith('src/app/') ||
        path.startsWith('src/components/')
      ) {
        result.ui_e2e = true
      }
    } else if (path.startsWith('public/')) {
      result.code = true
      result.ui_e2e = true
      result.production_image = true
      recognized = true
    } else if (path.startsWith('scripts/')) {
      result.code = true
      result.operations = true
      recognized = true

      if (path.startsWith('scripts/db/')) {
        result.database = true
      }
    } else if (path === 'Dockerfile' || path === '.dockerignore') {
      result.code = true
      result.operations = true
      result.production_image = true
      recognized = true
    } else if (/^compose(?:\.[a-z0-9-]+)?\.ya?ml$/.test(path)) {
      result.code = true
      result.operations = true
      recognized = true
    } else if (path === 'package.json' || path === 'pnpm-lock.yaml') {
      result.code = true
      result.production_image = true
      recognized = true
    } else if (path === 'next.config.ts' || path === 'tsconfig.json') {
      result.code = true
      result.ui_e2e = true
      result.production_image = true
      recognized = true
    } else if (path === 'playwright.config.ts') {
      result.code = true
      result.ui_e2e = true
      recognized = true
    } else if (path === 'vitest.integration.config.mts') {
      result.code = true
      result.database = true
      recognized = true
    } else if (path === 'vitest.operations.config.mts') {
      result.code = true
      result.operations = true
      recognized = true
    } else if (exactCodePaths.has(path)) {
      result.code = true
      recognized = true
    }

    if (!recognized) {
      return fullClassification()
    }
  }

  return result
}

const parseNulSeparatedPaths = (input) => {
  if (input.length === 0 || input[input.length - 1] !== 0) {
    throw new Error('expected a non-empty NUL-terminated path list')
  }

  const paths = input.toString('utf8').split('\0')
  paths.pop()
  if (paths.some((path) => path.length === 0)) {
    throw new Error('path list contains an empty entry')
  }

  return paths
}

const writeOutputs = (classification) => {
  const output = `${outputKeys.map((key) => `${key}=${String(classification[key])}`).join('\n')}\n`

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, output)
  } else {
    process.stdout.write(`${JSON.stringify(classification)}\n`)
  }
}

const runCli = () => {
  try {
    const paths = parseNulSeparatedPaths(readFileSync(0))
    writeOutputs(classifyChangedFiles(paths))
  } catch (error) {
    writeOutputs(fullClassification())
    process.stderr.write(
      `CI change classification failed closed: ${
        error instanceof Error ? error.message : 'unknown error'
      }\n`,
    )
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1]
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  runCli()
}
