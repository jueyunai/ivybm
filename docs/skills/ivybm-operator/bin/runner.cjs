#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * IVYBM Operator Runner
 * Zero-dependency CLI runner for IvyBM Portal APIs.
 * Supports secure token management, media uploads,
 * website content management (English & Arabic), and social draft creation/submission.
 */

const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const readline = require('readline')

const DEFAULT_ENDPOINT = process.env.IVYBM_ENDPOINT || 'http://localhost:3000'
const DEFAULT_AUTH_DIR = process.env.IVYBM_AUTH_DIR || path.join(os.homedir(), '.ivybm')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAuthDir(customDir) {
  return customDir || DEFAULT_AUTH_DIR
}

function getAuthFilePath(authDir) {
  return path.join(authDir, 'auth.json')
}

async function ensureDirectory(dir) {
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
}

async function readJSON(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeJSON(filePath, data, mode = 0o600) {
  const dir = path.dirname(filePath)
  await ensureDirectory(dir)
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), { mode, encoding: 'utf-8' })
  try {
    await fsp.chmod(filePath, mode)
  } catch {}
}

function formatApiError(res, text, actionDesc) {
  let detail = text
  try {
    const parsed = JSON.parse(text)
    detail = parsed.error?.message || parsed.errors?.[0]?.message || parsed.message || text
  } catch {}
  return new Error(`${actionDesc} failed (${res.status}): ${detail}`)
}

/**
 * Generates an idempotency key matching /^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/
 */
function generateIdempotencyKey(prefix = 'op') {
  const cleanPrefix = prefix.replace(/[^A-Za-z0-9]/g, '') || 'op'
  return `${cleanPrefix}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`
}

function assertValidIdempotencyKey(key) {
  if (key && !/^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/.test(key)) {
    throw new Error(
      `Invalid Idempotency-Key "${key}". Must match /^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/ (8-200 characters).`
    )
  }
}

function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const stdin = process.stdin
    const onData = (char) => {
      char = char + ''
      switch (char) {
        case '\n':
        case '\r':
        case ' ':
          break
        default:
          process.stdout.write('\x1B[2K\x1B[200D' + query + '*'.repeat(rl.line.length))
          break
      }
    }

    stdin.on('data', onData)
    rl.question(query, (value) => {
      stdin.removeListener('data', onData)
      rl.close()
      console.log('')
      resolve(value)
    })
  })
}

function promptText(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(query, (value) => {
      rl.close()
      resolve(value.trim())
    })
  })
}

// ---------------------------------------------------------------------------
// Authentication (Secure Token Storage, NO Plaintext Password on Disk or CLI)
// ---------------------------------------------------------------------------

async function loginInteractive({ endpoint, authDir: customDir }) {
  const base = (endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')
  const authDir = getAuthDir(customDir)

  console.log(`\n=== IVYBM Portal CLI 交互式登录 ===`)
  console.log(`目标服务: ${base}`)
  console.log(`(凭证仅在本地保存 JWT，绝不持久化明文密码)\n`)

  const username = await promptText('用户名: ')
  if (!username) throw new Error('用户名不能为空')

  const password = await promptHidden('密码: ')
  if (!password) throw new Error('密码不能为空')

  return await executeLogin({ endpoint: base, username, password, authDir })
}

/**
 * Programmatic login function (used by interactive prompt and programmatic test runners).
 * NEVER exposed as a CLI flag with password argument.
 */
async function executeLogin({ endpoint, username, password, authDir: customDir }) {
  const base = (endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')
  const authDir = getAuthDir(customDir)

  if (!username || !password) {
    throw new Error('Username and password are required for login')
  }

  try {
    const urlObj = new URL(base)
    if (urlObj.hostname !== 'localhost' && urlObj.hostname !== '127.0.0.1' && urlObj.protocol !== 'https:') {
      console.warn(`[Warning] 正在使用不安全的 HTTP 协议连接远程地址 (${base})，建议在生产环境使用 HTTPS。`)
    }
  } catch {}

  const signal = AbortSignal.timeout(30_000)
  const res = await fetch(`${base}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text()
    let msg = `登录失败 (HTTP ${res.status})`
    try {
      const parsed = JSON.parse(body)
      msg = parsed.errors?.[0]?.message || parsed.message || msg
    } catch {}
    throw new Error(msg)
  }

  const data = await res.json()
  const token = data.token
  if (!token) {
    throw new Error('登录成功但未返回 token')
  }

  const expiresAt = data.exp ? data.exp * 1000 : Date.now() + 2 * 60 * 60 * 1000

  // Security: DO NOT save password on disk
  const authData = {
    endpoint: base,
    token,
    user: data.user,
    expiresAt,
    updatedAt: new Date().toISOString(),
  }

  await writeJSON(getAuthFilePath(authDir), authData)
  return {
    success: true,
    user: data.user,
    expiresAt: new Date(expiresAt).toISOString(),
    endpoint: base,
  }
}

/**
 * Programmatic token setter (used by automated pipelines or test environments).
 */
async function setToken({ token, endpoint, authDir: customDir }) {
  const base = (endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')
  const authDir = getAuthDir(customDir)

  if (!token) throw new Error('Token is required')

  const authData = {
    endpoint: base,
    token: token.trim(),
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
    updatedAt: new Date().toISOString(),
  }

  await writeJSON(getAuthFilePath(authDir), authData)
  return { success: true, endpoint: base }
}

async function getAuthStatus(customDir) {
  const authDir = getAuthDir(customDir)
  const envToken = process.env.IVYBM_TOKEN
  if (envToken) {
    return {
      authenticated: true,
      source: 'env:IVYBM_TOKEN',
      endpoint: process.env.IVYBM_ENDPOINT || DEFAULT_ENDPOINT,
    }
  }

  const auth = await readJSON(getAuthFilePath(authDir))
  if (!auth || !auth.token) {
    return {
      authenticated: false,
      reason: '未检测到登录凭据。请在终端执行 `runner.cjs auth login` 完成交互式登录。',
    }
  }

  const isExpired = Date.now() >= (auth.expiresAt || 0)
  return {
    authenticated: !isExpired,
    user: auth.user,
    endpoint: auth.endpoint,
    expiresAt: auth.expiresAt ? new Date(auth.expiresAt).toISOString() : null,
    expired: isExpired,
    reason: isExpired ? 'Token 已过期，请在终端执行 `runner.cjs auth login` 重新登录。' : undefined,
  }
}

async function logout(customDir) {
  const authDir = getAuthDir(customDir)
  const file = getAuthFilePath(authDir)
  try {
    await fsp.unlink(file)
  } catch {}
  return { success: true }
}

async function getValidAuth(customDir) {
  const envToken = process.env.IVYBM_TOKEN
  if (envToken) {
    return {
      endpoint: process.env.IVYBM_ENDPOINT || DEFAULT_ENDPOINT,
      token: envToken,
    }
  }

  const authDir = getAuthDir(customDir)
  const auth = await readJSON(getAuthFilePath(authDir))
  if (!auth || !auth.token) {
    throw new Error('未认证。请先在终端运行 `runner.cjs auth login` 完成登录。')
  }

  if (Date.now() >= (auth.expiresAt || 0)) {
    throw new Error('会话 Token 已过期。请在终端运行 `runner.cjs auth login` 重新登录。')
  }

  return auth
}

/**
 * Performs authenticated requests with:
 * 1. Origin verification (prevents leaking JWT to third-party domains)
 * 2. Mandatory Idempotency-Key on mutating methods
 */
async function authenticatedFetch(pathOrUrl, options = {}, customDir) {
  const authDir = getAuthDir(customDir)
  const auth = await getValidAuth(authDir)

  let targetUrl
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    const parsedTarget = new URL(pathOrUrl)
    const expectedOrigin = new URL(auth.endpoint).origin
    if (parsedTarget.origin !== expectedOrigin) {
      throw new Error(
        `Security Error: Cross-origin request to "${parsedTarget.origin}" is blocked. Requests may only target "${expectedOrigin}".`
      )
    }
    targetUrl = pathOrUrl
  } else {
    if (!pathOrUrl.startsWith('/api/')) {
      throw new Error(`Path must start with "/api/". Got: "${pathOrUrl}"`)
    }
    targetUrl = `${auth.endpoint}${pathOrUrl}`
  }

  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `JWT ${auth.token}`)

  const method = (options.method || 'GET').toUpperCase()
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    if (!headers.has('Idempotency-Key')) {
      const explicitKey = options.idempotencyKey || generateIdempotencyKey('req')
      assertValidIdempotencyKey(explicitKey)
      headers.set('Idempotency-Key', explicitKey)
    }
  }

  const signal = options.signal || AbortSignal.timeout(30_000)
  const res = await fetch(targetUrl, { ...options, headers, signal })

  if (res.status === 401) {
    throw new Error('认证失败 (401 Unauthorized)。登录凭证已失效或权限不足，请在终端运行 `runner.cjs auth login`。')
  }

  return res
}

// ---------------------------------------------------------------------------
// Media Operations
// ---------------------------------------------------------------------------

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.avif':
      return 'image/avif'
    case '.pdf':
      return 'application/pdf'
    default:
      return 'application/octet-stream'
  }
}

async function uploadMedia({ filePath, alt, source, isPublic = false, idempotencyKey, customDir }) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const buffer = await fsp.readFile(filePath)
  const fileName = path.basename(filePath)
  const mimetype = detectMimeType(filePath)

  if (mimetype === 'application/octet-stream') {
    throw new Error(`Unsupported media extension for file "${fileName}". Allowed: jpg, png, webp, avif, pdf`)
  }

  const formData = new FormData()
  const blob = new Blob([buffer], { type: mimetype })
  formData.append('file', blob, fileName)
  formData.append('alt', alt || fileName)
  formData.append('source', source || 'codex-agent')
  formData.append('isPublic', isPublic ? 'true' : 'false')

  const res = await authenticatedFetch('/api/portal/media', {
    method: 'POST',
    body: formData,
    idempotencyKey,
  }, customDir)

  if (!res.ok) {
    const text = await res.text()
    throw formatApiError(res, text, 'Media upload')
  }

  return await res.json()
}

// ---------------------------------------------------------------------------
// Website Content Operations (Bilingual: English & Arabic)
// ---------------------------------------------------------------------------

async function getContentOptions({ type, customDir }) {
  const res = await authenticatedFetch(`/api/portal/content/${type}`, {
    method: 'GET',
  }, customDir)

  if (!res.ok) {
    const text = await res.text()
    throw formatApiError(res, text, `Get options for ${type}`)
  }

  return await res.json()
}

async function getContent({ type, id, locale = 'en', customDir }) {
  const params = new URLSearchParams()
  if (locale) params.set('locale', locale)

  const query = `?${params.toString()}`
  const res = await authenticatedFetch(`/api/portal/content/${type}/${id}${query}`, {
    method: 'GET',
  }, customDir)

  if (!res.ok) {
    const text = await res.text()
    throw formatApiError(res, text, `Get ${type} #${id}`)
  }

  return await res.json()
}

async function upsertContent({ type, id, payload, idempotencyKey, customDir }) {
  const isUpdate = Boolean(id)
  const url = isUpdate ? `/api/portal/content/${type}/${id}` : `/api/portal/content/${type}`
  const method = isUpdate ? 'PATCH' : 'POST'

  const bodyData = { ...payload }

  if (isUpdate && !bodyData.updatedAt) {
    throw new Error(`--updatedAt is required when updating existing content #${id} to prevent write collisions`)
  }

  if (!bodyData.locale || !['en', 'ar'].includes(bodyData.locale)) {
    throw new Error(`--locale must be explicitly specified as "en" or "ar"`)
  }

  const res = await authenticatedFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyData),
    idempotencyKey,
  }, customDir)

  if (!res.ok) {
    const text = await res.text()
    throw formatApiError(res, text, `${isUpdate ? 'Update' : 'Create'} ${type}`)
  }

  return await res.json()
}

async function deleteContent({ type, id, locale, updatedAt, idempotencyKey, customDir }) {
  if (!updatedAt) {
    throw new Error(`--updatedAt is required to delete content #${id}`)
  }
  if (!locale || !['en', 'ar'].includes(locale)) {
    throw new Error(`--locale (en or ar) is required to delete content #${id}`)
  }

  const res = await authenticatedFetch(`/api/portal/content/${type}/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale, updatedAt }),
    idempotencyKey,
  }, customDir)

  if (!res.ok) {
    const text = await res.text()
    throw formatApiError(res, text, `Delete ${type} #${id}`)
  }

  return await res.json()
}

// ---------------------------------------------------------------------------
// Social Content Studio Operations (Drafting & Submitting to Review ONLY)
// ---------------------------------------------------------------------------

async function createSocialDraft({ draft, idempotencyKey, customDir }) {
  const key = idempotencyKey || draft.idempotencyKey || generateIdempotencyKey('draft')
  assertValidIdempotencyKey(key)

  const payload = {
    idempotencyKey: key,
    title: draft.title,
    body: draft.body,
    platform: draft.platform,
    contentType: draft.contentType || 'post',
    contentLocale: draft.contentLocale || 'en',
    assets: draft.assets || [],
    knowledgeSources: draft.knowledgeSources || [],
    sourceReferences: draft.sourceReferences || [],
  }

  const res = await authenticatedFetch('/api/portal/content-studio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    idempotencyKey: key,
  }, customDir)

  if (!res.ok) {
    const text = await res.text()
    throw formatApiError(res, text, 'Create social draft')
  }

  return await res.json()
}

async function updateSocialDraft({ id, draft, updatedAt, idempotencyKey, customDir }) {
  const bodyData = { ...draft }
  if (updatedAt) {
    bodyData.updatedAt = updatedAt
  }
  if (!bodyData.updatedAt) {
    throw new Error(`--updatedAt is required when updating social draft #${id}`)
  }

  const res = await authenticatedFetch(`/api/portal/content-studio/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyData),
    idempotencyKey,
  }, customDir)

  if (!res.ok) {
    const text = await res.text()
    throw formatApiError(res, text, `Update social draft #${id}`)
  }

  return await res.json()
}

async function submitSocialReview({ id, updatedAt, idempotencyKey, customDir }) {
  if (!updatedAt) {
    throw new Error(`--updatedAt is required when submitting social draft #${id} for review`)
  }

  const res = await authenticatedFetch(`/api/portal/content-studio/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'submit-review', updatedAt }),
    idempotencyKey,
  }, customDir)

  if (!res.ok) {
    const text = await res.text()
    throw formatApiError(res, text, `Submit social draft #${id} for review`)
  }

  return await res.json()
}

// ---------------------------------------------------------------------------
// CLI Argument Parsing & Router
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {}
  const positionals = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const equalIdx = arg.indexOf('=')
      if (equalIdx !== -1) {
        const key = arg.slice(2, equalIdx)
        const val = arg.slice(equalIdx + 1)
        flags[key] = val
      } else {
        const key = arg.slice(2)
        const next = argv[i + 1]
        if (next && !next.startsWith('-')) {
          flags[key] = next
          i++
        } else {
          flags[key] = true
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const key = arg.slice(1)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positionals.push(arg)
    }
  }

  return { flags, positionals }
}

async function loadPayloadFromFileOrFlag(flags) {
  if (flags.file) {
    const raw = await fsp.readFile(flags.file, 'utf-8')
    return JSON.parse(raw)
  }
  if (flags.data) {
    return JSON.parse(flags.data)
  }
  return null
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.log(JSON.stringify({
      version: '1.0.0',
      description: 'IVYBM Operator Runner CLI',
      commands: [
        'auth status',
        'auth login [--endpoint <url>]',
        'auth logout',
        'media upload <file> [--alt <alt>] [--public] [--idempotency-key <key>]',
        'content options --type <products|product-categories|projects|posts|knowledge>',
        'content get --type <type> --id <id> [--locale en|ar]',
        'content upsert --type <type> [--id <id>] --file <file.json> --locale <en|ar> [--updatedAt <ts>] [--publish] [--idempotency-key <key>]',
        'content delete --type <type> --id <id> --locale <en|ar> --updatedAt <ts> [--idempotency-key <key>]',
        'social draft-create --file <file.json> [--idempotency-key <key>]',
        'social draft-update --id <id> --file <file.json> --updatedAt <ts> [--idempotency-key <key>]',
        'social draft-submit --id <id> --updatedAt <ts> [--idempotency-key <key>]',
      ]
    }, null, 2))
    return
  }

  const { flags, positionals } = parseArgs(args)
  const [scope, action] = positionals
  const customDir = flags['auth-dir']
  const idempotencyKey = flags['idempotency-key']

  try {
    let result

    // 1. Auth commands (NO --password or --token in argv for security)
    if (scope === 'auth') {
      if (action === 'status') {
        result = await getAuthStatus(customDir)
      } else if (action === 'login') {
        const endpoint = flags.endpoint || flags.e
        result = await loginInteractive({ endpoint, authDir: customDir })
      } else if (action === 'logout') {
        result = await logout(customDir)
      } else {
        throw new Error(`Unknown auth action: ${action}`)
      }
    }

    // 2. Media commands
    else if (scope === 'media') {
      if (action === 'upload') {
        const filePath = positionals[2] || flags.file
        if (!filePath) throw new Error('File path is required for media upload')
        const alt = flags.alt
        const source = flags.source
        const isPublic = Boolean(flags.public)
        result = await uploadMedia({ filePath, alt, source, isPublic, idempotencyKey, customDir })
      } else {
        throw new Error(`Unknown media action: ${action}`)
      }
    }

    // 3. Website content commands
    else if (scope === 'content') {
      const type = flags.type
      if (!type) throw new Error('--type is required for content operations')

      if (action === 'options') {
        result = await getContentOptions({ type, customDir })
      } else if (action === 'get') {
        const id = flags.id || positionals[2]
        if (!id) throw new Error('--id is required to get content')
        result = await getContent({ type, id, locale: flags.locale, customDir })
      } else if (action === 'upsert') {
        const id = flags.id
        const payload = (await loadPayloadFromFileOrFlag(flags)) || {}
        if (flags.locale) payload.locale = flags.locale
        if (flags.updatedAt) payload.updatedAt = flags.updatedAt
        if (flags.publish) payload.action = 'publish'
        if (flags.action) payload.action = flags.action

        result = await upsertContent({ type, id, payload, idempotencyKey, customDir })
      } else if (action === 'delete') {
        const id = flags.id || positionals[2]
        if (!id) throw new Error('--id is required to delete content')
        result = await deleteContent({
          type,
          id,
          locale: flags.locale,
          updatedAt: flags.updatedAt,
          idempotencyKey,
          customDir,
        })
      } else {
        throw new Error(`Unknown content action: ${action}`)
      }
    }

    // 4. Social content studio commands (Drafting & Submission ONLY)
    else if (scope === 'social') {
      if (action === 'draft-create') {
        const draft = await loadPayloadFromFileOrFlag(flags)
        if (!draft) throw new Error('--file or --data is required for draft-create')
        result = await createSocialDraft({ draft, idempotencyKey, customDir })
      } else if (action === 'draft-update') {
        const id = flags.id || positionals[2]
        if (!id) throw new Error('--id is required for draft-update')
        const draft = (await loadPayloadFromFileOrFlag(flags)) || {}
        result = await updateSocialDraft({
          id: Number(id),
          draft,
          updatedAt: flags.updatedAt,
          idempotencyKey,
          customDir,
        })
      } else if (action === 'draft-submit') {
        const id = flags.id || positionals[2]
        if (!id) throw new Error('--id is required for draft-submit')
        result = await submitSocialReview({
          id: Number(id),
          updatedAt: flags.updatedAt,
          idempotencyKey,
          customDir,
        })
      } else {
        throw new Error(`Unknown social action: ${action}. (Note: 审批与正式发布需在 /dashboard 中由人工执行)`)
      }
    }

    else {
      throw new Error(`Unknown command scope: ${scope}`)
    }

    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  } catch (err) {
    console.error(JSON.stringify({ error: err.message || String(err) }, null, 2))
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  executeLogin,
  setToken,
  getAuthStatus,
  logout,
  getValidAuth,
  uploadMedia,
  getContentOptions,
  getContent,
  upsertContent,
  deleteContent,
  createSocialDraft,
  updateSocialDraft,
  submitSocialReview,
  parseArgs,
  generateIdempotencyKey,
  authenticatedFetch,
}
