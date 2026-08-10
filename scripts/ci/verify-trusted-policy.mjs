import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { classifyChangedFiles } from './classify-changes.mjs'
import { createValidationPlan } from './plan-validation.mjs'

const apiVersion = '2022-11-28'
const shaPattern = /^[0-9a-f]{40}$/
const controlPlanePath = (path) =>
  path === '.github/CODEOWNERS' ||
  path.startsWith('.github/workflows/') ||
  path.startsWith('scripts/ci/')

const fullFallbackClassification = () => classifyChangedFiles([])

const requiredStepNames = [
  'Verify immutable event revision',
  'Resolve comparison and changed paths',
  'Prepare CI control plane',
  'Classify changed paths',
  'Normalize classification contract',
  'Validate repository diff and sensitive path boundary',
  'Plan validation stages',
  'Record validation stage outcomes',
]

const stageStepNames = {
  fast: 'Fast CI',
  database_start: 'Start database when required',
  database: 'Database gate',
  build: 'Production build',
  e2e: 'Browser E2E',
  operations: 'Operations gate',
  cleanup: 'Clean up database',
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const parseBoolean = (name, value) => {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

const parseJson = async (response, description) => {
  if (!response.ok) {
    throw new Error(`${description} failed with HTTP ${response.status}`)
  }
  return response.json()
}

const createApiClient = ({ repository, token }) => {
  if (!repository || !token) throw new Error('trusted policy API credentials are missing')

  const request = async (path) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': apiVersion,
      },
    })
    return parseJson(response, `GitHub API ${path}`)
  }

  return { request }
}

const listPullRequestFiles = async (api, pullRequestNumber) => {
  const files = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await api.request(
      `/pulls/${pullRequestNumber}/files?per_page=100&page=${page}`,
    )
    if (!Array.isArray(response)) throw new Error('GitHub pull request files response is invalid')
    const pageFiles = response.map((file) => file?.filename)
    if (pageFiles.some((filename) => typeof filename !== 'string')) {
      throw new Error('GitHub pull request file entry is invalid')
    }
    files.push(...pageFiles)
    if (response.length < 100) return files
  }
  throw new Error('pull request file list exceeded the fail-closed pagination limit')
}

const listCandidateRuns = async (api, headSha) => {
  const response = await api.request(
    `/actions/runs?head_sha=${headSha}&event=pull_request&per_page=100`,
  )
  if (!response || !Array.isArray(response.workflow_runs)) {
    throw new Error('GitHub workflow run response is invalid')
  }
  return response.workflow_runs
    .filter((run) => run?.name === 'CI' && run?.head_sha === headSha)
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
}

const waitForCandidateRun = async (api, headSha) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const [latestRun] = await listCandidateRuns(api, headSha)
    if (latestRun?.status === 'completed') return latestRun
    await sleep(15_000)
  }
  throw new Error('candidate CI run did not complete within the trusted policy window')
}

const expectedStageResults = ({ classification, isDraft, forceFull }) => {
  const plan = createValidationPlan({
    classification,
    eventName: 'pull_request_target',
    forceFull,
    isDraft,
  })

  return {
    build: plan.buildRequired ? 'success' : 'skipped',
    cleanup: plan.databaseRequired ? 'success' : 'skipped',
    database_start: plan.databaseRequired ? 'success' : 'skipped',
    database: plan.databaseRequired ? 'success' : 'skipped',
    e2e: plan.e2eRequired ? 'success' : 'skipped',
    fast: plan.fastRequired ? 'success' : 'skipped',
    operations: plan.operationsRequired ? 'success' : 'skipped',
    plan,
  }
}

const getJobSteps = (jobs) => {
  if (!Array.isArray(jobs)) return null
  const validationJobs = jobs.filter((job) => job?.name === 'CI validation')
  if (validationJobs.length !== 1) return null
  const [validationJob] = validationJobs
  if (validationJob.status !== 'completed' || validationJob.conclusion !== 'success') return null
  if (!Array.isArray(validationJob.steps)) return null

  return new Map(validationJob.steps.map((step) => [step.name, step.conclusion]))
}

export function validateWorkflowPermissions(workflows) {
  const errors = []
  for (const workflow of workflows ?? []) {
    if (typeof workflow?.path !== 'string' || typeof workflow?.content !== 'string') {
      errors.push('candidate workflow content is missing or invalid')
      continue
    }

    const writePermissions = [...workflow.content.matchAll(/^\s+packages:\s+write\s*$/gm)]
    if (/^\s+(?:contents|actions|pull-requests):\s+write\s*$/m.test(workflow.content)) {
      errors.push(`${workflow.path}: write token permissions are forbidden in PR workflows`)
    }
    if (writePermissions.length === 0) {
      if (/^\s+permissions:\s+write-all\s*$/m.test(workflow.content)) {
        errors.push(`${workflow.path}: write-all permissions are forbidden`)
      }
      continue
    }

    const publishStart = workflow.content.indexOf('  publish_production_images:')
    const nextJobOffset =
      publishStart >= 0 ? workflow.content.slice(publishStart + 2).search(/\n  [a-zA-Z0-9_]+:/) : -1
    const publishJob =
      publishStart >= 0
        ? workflow.content.slice(
            publishStart,
            nextJobOffset >= 0 ? publishStart + 2 + nextJobOffset : workflow.content.length,
          )
        : undefined
    const allowedPublishWrite =
      workflow.path === '.github/workflows/ci.yml' &&
      writePermissions.length === 1 &&
      publishJob?.includes('packages: write') &&
      publishJob.includes("github.event_name == 'push'") &&
      publishJob.includes("github.ref == 'refs/heads/main'")

    if (!allowedPublishWrite) {
      errors.push(`${workflow.path}: packages: write is not restricted to the main publish job`)
    }
  }
  return errors
}

export function evaluateTrustedPolicy({
  baseSha,
  checkedHeadSha,
  classification,
  forceFull,
  headSha,
  isDraft,
  jobs,
  run,
  workflowErrors = [],
}) {
  const errors = [...workflowErrors]
  if (!shaPattern.test(baseSha ?? '')) errors.push('base SHA is missing or invalid')
  if (!shaPattern.test(headSha ?? '')) errors.push('head SHA is missing or invalid')
  if (checkedHeadSha !== headSha) errors.push('candidate run head SHA does not match the PR head')
  if (run?.event !== 'pull_request') errors.push('candidate run is not a pull_request run')
  if (run?.head_sha !== headSha) errors.push('candidate run head SHA is stale or mismatched')
  if (run?.status !== 'completed' || run?.conclusion !== 'success') {
    errors.push('candidate CI run is not a successful completed run')
  }
  if (typeof isDraft !== 'boolean') errors.push('Draft state is missing or invalid')
  if (typeof forceFull !== 'boolean') errors.push('forceFull is missing or invalid')

  const steps = getJobSteps(jobs)
  if (!steps) {
    errors.push('candidate CI validation job or its completed steps are missing')
    return { errors, ok: false, plan: null }
  }

  for (const name of requiredStepNames) {
    if (steps.get(name) !== 'success') {
      errors.push(`trusted control step ${name} is missing or not successful`)
    }
  }

  let expected
  try {
    expected = expectedStageResults({ classification, forceFull, isDraft })
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'trusted validation plan is invalid')
    return { errors, ok: false, plan: null }
  }

  for (const [stage, expectedConclusion] of Object.entries(expected)) {
    if (stage === 'plan') continue
    const stepName = stageStepNames[stage]
    const actualConclusion = steps.get(stepName)
    if (actualConclusion !== expectedConclusion) {
      errors.push(
        `${stepName}: expected ${expectedConclusion}, got ${actualConclusion ?? 'missing'}`,
      )
    }
  }

  const setupConclusion = expected.plan.fastRequired ? 'success' : 'skipped'
  for (const name of ['Set up pnpm', 'Set up Node.js', 'Install dependencies once']) {
    if (steps.get(name) !== setupConclusion) {
      errors.push(`${name}: expected ${setupConclusion}, got ${steps.get(name) ?? 'missing'}`)
    }
  }

  return { errors, ok: errors.length === 0, plan: expected.plan }
}

const runCli = async () => {
  const repository = process.env.REPOSITORY
  const token = process.env.GH_TOKEN
  const baseSha = process.env.BASE_SHA
  const headSha = process.env.HEAD_SHA
  const pullRequestNumber = Number(process.env.PR_NUMBER)
  const isDraft = parseBoolean('IS_DRAFT', process.env.IS_DRAFT)

  if (!shaPattern.test(baseSha ?? '') || !shaPattern.test(headSha ?? '')) {
    throw new Error('trusted policy base/head SHA is missing or invalid')
  }

  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new Error('PR_NUMBER is missing or invalid')
  }

  const api = createApiClient({ repository, token })
  const paths = await listPullRequestFiles(api, pullRequestNumber)
  const workflowEntries = await api.request(`/contents/.github/workflows?ref=${headSha}`)
  if (!Array.isArray(workflowEntries))
    throw new Error('candidate workflow directory response is invalid')
  const workflows = []
  for (const entry of workflowEntries) {
    if (entry?.type !== 'file' || typeof entry.path !== 'string') {
      throw new Error('candidate workflow directory contains an invalid entry')
    }
    const contentResponse = await api.request(`/contents/${entry.path}?ref=${headSha}`)
    if (typeof contentResponse?.content !== 'string') {
      throw new Error(`candidate workflow ${entry.path} content is unavailable`)
    }
    workflows.push({
      content: Buffer.from(contentResponse.content.replace(/\s/g, ''), 'base64').toString('utf8'),
      path: entry.path,
    })
  }
  const workflowErrors = validateWorkflowPermissions(workflows)
  const classification = classifyChangedFiles(paths)
  const forceFull = paths.some(controlPlanePath)
  const effectiveClassification = forceFull ? fullFallbackClassification() : classification
  const run = await waitForCandidateRun(api, headSha)
  const jobsResponse = await api.request(`/actions/runs/${run.id}/jobs?per_page=100`)
  const evaluation = evaluateTrustedPolicy({
    baseSha,
    checkedHeadSha: run.head_sha,
    classification: effectiveClassification,
    forceFull,
    headSha,
    isDraft,
    jobs: jobsResponse.jobs,
    run,
    workflowErrors,
  })

  const summary = [
    '## CI policy',
    '',
    '- Policy source: `base-owned pull_request_target`',
    `- Base revision: \`${baseSha}\``,
    `- Head revision: \`${headSha}\``,
    `- Candidate CI run: \`${run.id}\``,
    `- Classification: ${Object.entries(effectiveClassification)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')}`,
    `- Mode: ${evaluation.plan?.mode ?? 'invalid'}`,
  ]
  if (!evaluation.ok) {
    summary.push('', '### Policy errors', ...evaluation.errors.map((error) => `- ${error}`))
    process.stderr.write(`${evaluation.errors.join('\n')}\n`)
    process.exitCode = 1
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`)
  } else {
    process.stdout.write(`${summary.join('\n')}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'unknown trusted policy error'}\n`,
    )
    process.exitCode = 1
  })
}
