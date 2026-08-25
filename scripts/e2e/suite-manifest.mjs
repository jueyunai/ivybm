import { createHash } from 'node:crypto'

const mutationSpecs = [
  'tests/e2e/admin-portal-ai-settings.spec.ts',
  'tests/e2e/admin-portal-auth.spec.ts',
  'tests/e2e/admin-portal-content-studio.spec.ts',
  'tests/e2e/admin-portal-content.spec.ts',
  'tests/e2e/admin-portal-conversations.spec.ts',
  'tests/e2e/admin-portal-css-isolation.spec.ts',
  'tests/e2e/admin-portal-facebook-messenger.spec.ts',
  'tests/e2e/admin-portal-knowledge.spec.ts',
  'tests/e2e/admin-portal-leads.spec.ts',
  'tests/e2e/admin-portal-media.spec.ts',
  'tests/e2e/admin-portal-overview.spec.ts',
  'tests/e2e/admin-portal-platforms-operations.spec.ts',
  'tests/e2e/admin-portal-shell.spec.ts',
  'tests/e2e/admin-visual.spec.ts',
  'tests/e2e/chat-handoff.spec.ts',
  'tests/e2e/inquiry.spec.ts',
  'tests/e2e/website-chat-real.spec.ts',
  'tests/e2e/website.spec.ts',
]

// Official publishing is an explicit local-only checkpoint. It is deliberately
// excluded from the default/full mutation plan: those paths keep the publishing
// kill switch disabled and must never exercise provider side effects.
const optInMutationSpecs = ['tests/e2e/admin-portal-facebook-publishing.spec.ts']

// Full mutation coverage is deliberately split into isolated launcher runs.
// Keeping the order stable makes failures reproducible while giving every
// suite a fresh database, worker queue, and server process.
export const fullMutationSuiteNames = Object.freeze([
  'admin',
  'inquiry',
  'website',
  'chat',
  'visual',
])

export const e2eSuiteManifest = Object.freeze({
  admin: Object.freeze({
    mode: 'mutation',
    specs: mutationSpecs.filter((spec) => spec.includes('admin-')),
  }),
  'facebook-publishing': Object.freeze({
    mode: 'mutation',
    specs: optInMutationSpecs,
  }),
  chat: Object.freeze({
    mode: 'mutation',
    specs: ['tests/e2e/chat-handoff.spec.ts', 'tests/e2e/website-chat-real.spec.ts'],
  }),
  cms: Object.freeze({
    mode: 'mutation',
    specs: ['tests/e2e/admin-portal-content.spec.ts'],
  }),
  inquiry: Object.freeze({ mode: 'mutation', specs: ['tests/e2e/inquiry.spec.ts'] }),
  visual: Object.freeze({ mode: 'mutation', specs: ['tests/e2e/website-visual.spec.ts'] }),
  'readonly-visual': Object.freeze({
    mode: 'readonly-external',
    specs: ['tests/e2e/website-visual.spec.ts'],
  }),
  website: Object.freeze({ mode: 'mutation', specs: ['tests/e2e/website.spec.ts'] }),
})

const allSpecs = [...mutationSpecs, ...optInMutationSpecs, 'tests/e2e/website-visual.spec.ts']
const defaultMutationSpecs = [...mutationSpecs]

export const e2eSpecPaths = Object.freeze(allSpecs)

export const resolveE2ESuitePlan = (requestedSuites = []) => {
  const suiteNames = requestedSuites.length > 0 ? requestedSuites : ['full']
  const requestsFull = suiteNames.includes('full')
  if (requestsFull && suiteNames.length > 1) {
    throw new Error('The full E2E suite cannot be combined with another suite ID')
  }
  const expandedNames = requestsFull ? [] : suiteNames

  if (expandedNames.some((name) => name.startsWith('-'))) {
    throw new Error('E2E launcher accepts suite IDs only; Playwright options are not supported')
  }

  const unknown = expandedNames.filter((name) => !e2eSuiteManifest[name])
  if (unknown.length > 0) {
    throw new Error(`Unknown E2E suite ID: ${unknown.join(', ')}`)
  }

  if (requestsFull) {
    const plan = { mode: 'mutation', requestedSuites: ['full'], specs: defaultMutationSpecs }
    const planDigest = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
    return Object.freeze({ ...plan, planDigest })
  }

  const modes = new Set(expandedNames.map((name) => e2eSuiteManifest[name].mode))
  if (modes.size > 1) {
    throw new Error('Read-only visual E2E cannot be mixed with mutation suites')
  }

  const specs = [...new Set(expandedNames.flatMap((name) => e2eSuiteManifest[name].specs))]
  const mode = [...modes][0]
  const plan = { mode, requestedSuites: expandedNames, specs }
  const planDigest = createHash('sha256').update(JSON.stringify(plan)).digest('hex')

  return Object.freeze({ ...plan, planDigest })
}

export const manifestSpecCoverage = () => {
  const manifestSpecs = new Set(Object.values(e2eSuiteManifest).flatMap(({ specs }) => specs))
  return {
    missing: allSpecs.filter((spec) => !manifestSpecs.has(spec)),
    extra: [...manifestSpecs].filter((spec) => !allSpecs.includes(spec)),
    duplicate: allSpecs.filter((spec, index) => allSpecs.indexOf(spec) !== index),
  }
}
