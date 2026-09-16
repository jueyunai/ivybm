import fsp from 'fs/promises'
import path from 'path'
import os from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Import functions from the CommonJS runner
// eslint-disable-next-line @typescript-eslint/no-require-imports
const runner = require('../../skills/ivybm-operator/bin/runner.cjs')

describe('IVYBM Operator Runner', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ivybm-runner-test-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      await fsp.rm(testDir, { recursive: true, force: true })
    } catch {}
  })

  describe('CLI Argument Parsing & Idempotency Key', () => {
    it('parses commands, positional arguments, and flags accurately', () => {
      const parsed = runner.parseArgs([
        'content',
        'upsert',
        '--type',
        'products',
        '--id',
        '42',
        '--publish',
        '--locale=ar',
        '--idempotency-key=custom-key-12345',
      ])

      expect(parsed.positionals).toEqual(['content', 'upsert'])
      expect(parsed.flags).toEqual({
        type: 'products',
        id: '42',
        publish: true,
        locale: 'ar',
        'idempotency-key': 'custom-key-12345',
      })
    })

    it('generates valid Idempotency-Key matching backend pattern', () => {
      const key = runner.generateIdempotencyKey('test')
      expect(key).toMatch(/^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/)
    })
  })

  describe('Authentication & Zero-Plaintext-Password Security', () => {
    it('saves JWT token but NEVER saves password to auth.json', async () => {
      const mockUser = { id: 1, username: 'operator1', role: 'operator' }
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            token: 'mock-jwt-token',
            exp: Math.floor(Date.now() / 1000) + 7200,
            user: mockUser,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      vi.stubGlobal('fetch', mockFetch)

      const result = await runner.executeLogin({
        endpoint: 'http://localhost:3000',
        username: 'operator1',
        password: 'secret-password-123',
        authDir: testDir,
      })

      expect(result.success).toBe(true)
      expect(result.user).toEqual(mockUser)

      const authFile = path.join(testDir, 'auth.json')
      const stored = JSON.parse(await fsp.readFile(authFile, 'utf-8'))
      expect(stored.token).toBe('mock-jwt-token')
      expect(stored.user).toEqual(mockUser)
      // Blocking 1 & 2 check: password MUST NOT be stored on disk
      expect(stored.credentials).toBeUndefined()
      expect(stored.password).toBeUndefined()

      // Verify file permissions are 0600
      const stat = await fsp.stat(authFile)
      expect(stat.mode & 0o777).toBe(0o600)
    })

    it('allows setting token programmatically via setToken', async () => {
      await runner.setToken({
        token: 'manual-token',
        endpoint: 'https://cms.example.com',
        authDir: testDir,
      })

      const status = await runner.getAuthStatus(testDir)
      expect(status.authenticated).toBe(true)
      expect(status.endpoint).toBe('https://cms.example.com')
    })

    it('reports unauthenticated when token is expired or missing', async () => {
      const statusMissing = await runner.getAuthStatus(testDir)
      expect(statusMissing.authenticated).toBe(false)

      await fsp.writeFile(
        path.join(testDir, 'auth.json'),
        JSON.stringify({
          token: 'expired-token',
          expiresAt: Date.now() - 1000,
        }),
      )

      const statusExpired = await runner.getAuthStatus(testDir)
      expect(statusExpired.authenticated).toBe(false)
      expect(statusExpired.expired).toBe(true)
    })

    it('clears auth on logout', async () => {
      await fsp.writeFile(
        path.join(testDir, 'auth.json'),
        JSON.stringify({ token: 'test', expiresAt: Date.now() + 100000 }),
      )
      await runner.logout(testDir)
      const status = await runner.getAuthStatus(testDir)
      expect(status.authenticated).toBe(false)
    })
  })

  describe('Security: Origin Restriction & Idempotency-Key Header Enforcement', () => {
    beforeEach(async () => {
      await fsp.writeFile(
        path.join(testDir, 'auth.json'),
        JSON.stringify({
          endpoint: 'http://localhost:3000',
          token: 'valid-token',
          expiresAt: Date.now() + 3600000,
        }),
      )
    })

    it('blocks cross-origin requests to prevent leaking JWT token', async () => {
      await expect(
        runner.authenticatedFetch('https://malicious-third-party.com/steal', {}, testDir),
      ).rejects.toThrow(/Security Error: Cross-origin request to/)
    })

    it('blocks relative paths that do not start with /api/', async () => {
      await expect(
        runner.authenticatedFetch('/unauthorized/path', {}, testDir),
      ).rejects.toThrow(/Path must start with "\/api\/"/)
    })

    it('injects valid Idempotency-Key Header on POST, PATCH, and DELETE requests', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ result: { success: true } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      vi.stubGlobal('fetch', mockFetch)

      // POST request
      await runner.authenticatedFetch('/api/portal/test-post', { method: 'POST' }, testDir)
      const postHeaders = mockFetch.mock.calls[0][1]?.headers as Headers
      expect(postHeaders.get('Authorization')).toBe('JWT valid-token')
      expect(postHeaders.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/)

      // PATCH request
      await runner.authenticatedFetch('/api/portal/test-patch', { method: 'PATCH' }, testDir)
      const patchHeaders = mockFetch.mock.calls[1][1]?.headers as Headers
      expect(patchHeaders.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/)

      // DELETE request
      await runner.authenticatedFetch('/api/portal/test-delete', { method: 'DELETE' }, testDir)
      const deleteHeaders = mockFetch.mock.calls[2][1]?.headers as Headers
      expect(deleteHeaders.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$/)

      // GET request does NOT require Idempotency-Key
      await runner.authenticatedFetch('/api/portal/test-get', { method: 'GET' }, testDir)
      const getHeaders = mockFetch.mock.calls[3][1]?.headers as Headers
      expect(getHeaders.get('Idempotency-Key')).toBeNull()
    })

    it('respects explicitly provided idempotencyKey for retries', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ result: { success: true } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      vi.stubGlobal('fetch', mockFetch)

      const customKey = 'retry.12345678.abcdef'
      await runner.authenticatedFetch(
        '/api/portal/retry',
        { method: 'POST', idempotencyKey: customKey },
        testDir,
      )

      const headers = mockFetch.mock.calls[0][1]?.headers as Headers
      expect(headers.get('Idempotency-Key')).toBe(customKey)
    })

    it('maps 401 Unauthorized to a clear error message instructing to re-login', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockImplementation(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 })),
      )
      vi.stubGlobal('fetch', mockFetch)

      await expect(
        runner.authenticatedFetch('/api/portal/secure', { method: 'GET' }, testDir),
      ).rejects.toThrow(/认证失败 \(401 Unauthorized\)/)
    })
  })

  describe('Website Content Operations (English & Arabic Bilingual SOP)', () => {
    beforeEach(async () => {
      await fsp.writeFile(
        path.join(testDir, 'auth.json'),
        JSON.stringify({
          endpoint: 'http://localhost:3000',
          token: 'valid-token',
          expiresAt: Date.now() + 3600000,
        }),
      )
    })

    it('requires --locale and rejects invalid locales', async () => {
      await expect(
        runner.upsertContent({
          type: 'products',
          payload: { title: 'Panel' },
          customDir: testDir,
        }),
      ).rejects.toThrow(/--locale must be explicitly specified as "en" or "ar"/)
    })

    it('requires --updatedAt when updating existing content by id to prevent stale write collisions', async () => {
      await expect(
        runner.upsertContent({
          type: 'products',
          id: 15,
          payload: { title: 'Panel', locale: 'ar' },
          customDir: testDir,
        }),
      ).rejects.toThrow(/--updatedAt is required when updating existing content #15/)
    })

    it('correctly creates English record and then updates Arabic record with updatedAt', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockImplementation((url, opts) => {
        const urlStr = String(url)
        const method = opts?.method
        if (urlStr.endsWith('/api/portal/content/products') && method === 'POST') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                result: {
                  id: 15,
                  title: 'Aluminum Screen',
                  locale: 'en',
                  status: 'draft',
                  updatedAt: '2026-09-16T12:00:00.000Z',
                },
              }),
              { status: 201, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        if (urlStr.endsWith('/api/portal/content/products/15') && method === 'PATCH') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                result: {
                  id: 15,
                  title: 'شاشة ألومنيوم ديكورية',
                  locale: 'ar',
                  status: 'published',
                  updatedAt: '2026-09-16T12:05:00.000Z',
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      })
      vi.stubGlobal('fetch', mockFetch)

      // Step 1: Create EN record
      const createRes = await runner.upsertContent({
        type: 'products',
        payload: { title: 'Aluminum Screen', locale: 'en' },
        customDir: testDir,
      })
      expect(createRes.result.id).toBe(15)
      expect(createRes.result.updatedAt).toBe('2026-09-16T12:00:00.000Z')

      // Step 2: Update AR record with id and updatedAt
      const updateRes = await runner.upsertContent({
        type: 'products',
        id: 15,
        payload: {
          title: 'شاشة ألومنيوم ديكورية',
          locale: 'ar',
          updatedAt: createRes.result.updatedAt,
          action: 'publish',
        },
        customDir: testDir,
      })
      expect(updateRes.result.id).toBe(15)
      expect(updateRes.result.locale).toBe('ar')
      expect(updateRes.result.status).toBe('published')
    })
  })

  describe('Media Upload & Social Content Studio (Restricted SOP)', () => {
    beforeEach(async () => {
      await fsp.writeFile(
        path.join(testDir, 'auth.json'),
        JSON.stringify({
          endpoint: 'http://localhost:3000',
          token: 'valid-token',
          expiresAt: Date.now() + 3600000,
        }),
      )
    })

    it('rejects unsupported media extensions like .gif or .exe', async () => {
      const tempGif = path.join(testDir, 'panel.gif')
      await fsp.writeFile(tempGif, Buffer.from('GIF89a'))

      await expect(
        runner.uploadMedia({
          filePath: tempGif,
          customDir: testDir,
        }),
      ).rejects.toThrow(/Unsupported media extension/)
    })

    it('uploads valid media (png/jpg/webp/avif) with Idempotency-Key Header', async () => {
      const tempImage = path.join(testDir, 'facade.webp')
      await fsp.writeFile(tempImage, Buffer.from([0x52, 0x49, 0x46, 0x46]))

      const mockFetch = vi.fn<typeof fetch>().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ result: { id: 101, url: '/media/facade.webp' } }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      )
      vi.stubGlobal('fetch', mockFetch)

      const res = await runner.uploadMedia({
        filePath: tempImage,
        alt: 'Facade Panel',
        source: 'codex',
        isPublic: true,
        customDir: testDir,
      })

      expect(res.result.id).toBe(101)
      const headers = mockFetch.mock.calls[0][1]?.headers as Headers
      expect(headers.get('Idempotency-Key')).toBeTruthy()
      expect(headers.get('Authorization')).toBe('JWT valid-token')
    })

    it('creates social draft and submits for review adhering strictly to production DTO ({ content, duplicate } & status: "review")', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockImplementation((url) => {
        const urlStr = String(url)
        // Production create draft returns: { content: { id, status: 'draft', updatedAt }, duplicate: false }
        if (urlStr.endsWith('/api/portal/content-studio')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                content: {
                  id: 88,
                  status: 'draft',
                  updatedAt: '2026-09-16T12:00:00.000Z',
                  title: 'Engineering Post',
                },
                duplicate: false,
              }),
              {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          )
        }
        // Production submit-review returns: { content: { id, status: 'review', updatedAt } }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: {
                id: 88,
                status: 'review',
                updatedAt: '2026-09-16T12:05:00.000Z',
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      })
      vi.stubGlobal('fetch', mockFetch)

      // 1. Create draft
      const draftResult = await runner.createSocialDraft({
        draft: { title: 'Engineering Post', platform: 'linkedin', body: 'Draft body' },
        customDir: testDir,
      })
      expect(draftResult.content.id).toBe(88)
      expect(draftResult.content.status).toBe('draft')
      expect(draftResult.duplicate).toBe(false)

      // 2. Requires updatedAt when submitting review
      await expect(
        runner.submitSocialReview({
          id: 88,
          customDir: testDir,
        }),
      ).rejects.toThrow(/--updatedAt is required when submitting social draft #88/)

      // 3. Submit for review with updatedAt
      const submitResult = await runner.submitSocialReview({
        id: 88,
        updatedAt: draftResult.content.updatedAt,
        customDir: testDir,
      })
      // Assert status is 'review' (strictly matches GENERATED_CONTENT_STATUSES in production)
      expect(submitResult.content.status).toBe('review')
      expect(submitResult.content.id).toBe(88)

      const submitHeaders = mockFetch.mock.calls[1][1]?.headers as Headers
      expect(submitHeaders.get('Idempotency-Key')).toBeTruthy()
      const submitBody = JSON.parse(mockFetch.mock.calls[1][1]?.body as string)
      expect(submitBody.action).toBe('submit-review')
      expect(submitBody.updatedAt).toBe('2026-09-16T12:00:00.000Z')
    })

    it('updates social draft with updatedAt and handles 409 stale collisions gracefully', async () => {
      let callCount = 0
      const mockFetch = vi.fn<typeof fetch>().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // Success
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 88,
                title: 'Updated Title',
                status: 'draft',
                updatedAt: '2026-09-16T12:10:00.000Z',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        // Stale collision 409
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'content-studio-stale',
                message: 'This draft changed. Reload before updating.',
              },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      })
      vi.stubGlobal('fetch', mockFetch)

      // 1. Requires updatedAt
      await expect(
        runner.updateSocialDraft({
          id: 88,
          draft: { title: 'Updated' },
          customDir: testDir,
        }),
      ).rejects.toThrow(/--updatedAt is required when updating social draft #88/)

      // 2. Successful update
      const updateRes = await runner.updateSocialDraft({
        id: 88,
        draft: { title: 'Updated' },
        updatedAt: '2026-09-16T12:00:00.000Z',
        customDir: testDir,
      })
      expect(updateRes.id).toBe(88)
      expect(updateRes.updatedAt).toBe('2026-09-16T12:10:00.000Z')

      // 3. 409 Conflict formatted error
      await expect(
        runner.updateSocialDraft({
          id: 88,
          draft: { title: 'Conflicting update' },
          updatedAt: '2026-09-16T12:00:00.000Z',
          customDir: testDir,
        }),
      ).rejects.toThrow(/Update social draft #88 failed \(409\): This draft changed/)
    })
  })
})
