import { randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import { getMediaPage, loadMediaPageData } from '@/admin-portal/modules/media/getMediaPage'
import { contentStudioInternalWriteContext } from '@/access/contentStudio'
import { adoptContentStudioImage, type ContentStudioPayload } from '@/admin-portal/modules/content-studio/contentStudioCommands'
import { loadContentStudioPageData, parseContentStudioQuery } from '@/admin-portal/modules/content-studio/getContentStudioPage'
import {
  createPortalMedia,
  deletePortalMedia,
  updatePortalMedia,
} from '@/admin-portal/modules/media/mediaCommands'
import type { User } from '@/payload-types'
import config from '@/payload.config'

let payload: Payload
let admin: User
let operator: User
let sales: User
const createdMediaIDs: Array<number | string> = []
const createdUserIDs: Array<number | string> = []
const createdContentIDs: Array<number | string> = []
let queryToken = ''

const requestFor = (user: User) => createLocalReq({ user }, payload)

const buildMinimalPDF = (): Buffer => {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 48 >>\nstream\nBT /F1 12 Tf 36 72 Td (IVYBM demo PDF) Tj ET\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += object
  }

  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf)
}

describe.sequential('Portal media access', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for Portal media integration tests')
    }

    payload = await getPayload({
      config,
      disableOnInit: true,
      key: 'admin-portal-media-access-integration-tests',
    })

    const suffix = randomUUID()
    queryToken = `P07-${suffix}`
    for (const role of ['admin', 'operator', 'sales'] as const) {
      const user = await payload.create({
        collection: 'users',
        context: { skipAudit: true },
        data: {
          email: `portal-media-${role}-${suffix}@example.invalid`,
          password: 'portal-media-integration-password',
          role,
        },
        overrideAccess: true,
      })
      createdUserIDs.push(user.id)
      if (role === 'admin') admin = user
      if (role === 'operator') operator = user
      if (role === 'sales') sales = user
    }

    const image = await sharp({
      create: { background: '#4f46e5', channels: 3, height: 600, width: 800 },
    })
      .webp()
      .toBuffer()
    const imageMedia = await payload.create({
      collection: 'media',
      context: { disableRevalidate: true },
      data: {
        alt: `${queryToken} facade image`,
        isPublic: true,
        source: `${queryToken} owned photography`,
      },
      file: {
        data: image,
        mimetype: 'image/webp',
        name: `portal-media-${suffix}.webp`,
        size: image.length,
      },
      overrideAccess: true,
    })
    createdMediaIDs.push(imageMedia.id)

    const pdf = buildMinimalPDF()
    const pdfMedia = await payload.create({
      collection: 'media',
      context: { disableRevalidate: true },
      data: {
        alt: `${queryToken} private PDF`,
        isPublic: false,
        source: `${queryToken} internal document`,
      },
      file: {
        data: pdf,
        mimetype: 'application/pdf',
        name: `portal-media-${suffix}.pdf`,
        size: pdf.length,
      },
      overrideAccess: true,
    })
    createdMediaIDs.push(pdfMedia.id)
  })

  afterAll(async () => {
    if (!payload) return

    for (const id of createdContentIDs.reverse()) {
      await payload.delete({
        collection: 'generated-contents',
        context: { ...contentStudioInternalWriteContext, disableRevalidate: true },
        id,
        overrideAccess: true,
      }).catch(() => undefined)
    }
    for (const id of createdMediaIDs.reverse()) {
      await payload
        .delete({
          collection: 'media',
          context: { disableRevalidate: true },
          id,
          overrideAccess: true,
        })
        .catch(() => undefined)
    }
    if (createdUserIDs.length > 0) {
      await payload.delete({
        collection: 'audit-logs',
        overrideAccess: true,
        where: { actor: { in: createdUserIDs } },
      })
      await payload.delete({
        collection: 'users',
        context: { skipAudit: true },
        overrideAccess: true,
        where: { id: { in: createdUserIDs } },
      })
    }
    await payload.destroy()
  })

  it('lets administrators and operators read authorized image and PDF metadata', async () => {
    for (const user of [admin, operator]) {
      const summary = await getMediaPage({
        payload,
        query: {
          kind: 'all',
          page: 1,
          q: queryToken,
          source: '',
          view: 'grid',
          visibility: 'all',
        },
        req: await requestFor(user),
      })

      expect(summary.items).toHaveLength(2)
      expect(summary.items.map((item) => item.kind).sort()).toEqual(['image', 'pdf'])
      expect(summary.items.map((item) => item.isPublic).sort()).toEqual([false, true])
      expect(JSON.stringify(summary)).not.toMatch(/\/admin|focalX|focalY|password|token/i)
    }
  })

  it('applies kind and public-state filters through the authoritative Media collection', async () => {
    const summary = await getMediaPage({
      payload,
      query: {
        kind: 'pdf',
        page: 1,
        q: queryToken,
        source: '',
        view: 'list',
        visibility: 'private',
      },
      req: await requestFor(operator),
    })

    expect(summary.items).toHaveLength(1)
    expect(summary.items[0]).toMatchObject({ isPublic: false, kind: 'pdf' })
  })

  it('lets an operator upload, edit, audit, and delete an unreferenced asset', async () => {
    const image = await sharp({
      create: { background: '#563cf6', channels: 3, height: 320, width: 480 },
    })
      .png()
      .toBuffer()
    const req = await requestFor(operator)
    const created = await createPortalMedia({
      file: {
        data: image,
        mimetype: 'image/png',
        name: `portal-command-${randomUUID()}.png`,
        size: image.length,
      },
      input: {
        alt: 'Portal command upload',
        isPublic: false,
        source: 'IVYBM generated integration fixture',
      },
      payload,
      req,
    })
    createdMediaIDs.push(created.id)

    const updated = await updatePortalMedia({
      id: created.id,
      input: {
        alt: 'Portal command upload updated',
        isPublic: true,
        source: 'IVYBM owned integration fixture',
        updatedAt: created.updatedAt,
      },
      payload,
      req,
    })
    expect(updated).toMatchObject({ alt: 'Portal command upload updated', isPublic: true })

    await expect(
      deletePortalMedia({
        id: created.id,
        payload,
        req,
        updatedAt: updated.updatedAt,
      }),
    ).resolves.toMatchObject({ id: created.id })
    createdMediaIDs.splice(createdMediaIDs.indexOf(created.id), 1)

    const audits = await payload.find({
      collection: 'audit-logs',
      overrideAccess: true,
      pagination: false,
      where: {
        and: [
          { actor: { equals: operator.id } },
          { documentId: { equals: String(created.id) } },
          { resource: { equals: 'media' } },
        ],
      },
    })
    expect(audits.docs.map((audit) => audit.action).sort()).toEqual(['create', 'delete', 'update'])
  })

  it('lets an operator adopt a private image into a draft and reads its safe preview', async () => {
    const image = await sharp({
      create: { background: '#315868', channels: 3, height: 320, width: 480 },
    }).png().toBuffer()
    const req = await requestFor(operator)
    const media = await createPortalMedia({
      file: { data: image, mimetype: 'image/png', name: `portal-adoption-${randomUUID()}.png`, size: image.length },
      input: { alt: `${queryToken} generated draft image`, isPublic: false, source: 'IVYBM generated integration fixture' },
      payload,
      req,
    })
    createdMediaIDs.push(media.id)
    const content = await payload.create({
      collection: 'generated-contents',
      context: { ...contentStudioInternalWriteContext, disableRevalidate: true },
      data: {
        body: 'Draft body for image adoption.',
        contentLocale: 'en',
        contentType: 'post',
        createdBy: operator.id,
        creationFingerprint: randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
        idempotencyKey: `portal-content-adoption-${randomUUID()}`,
        platform: 'linkedin',
        status: 'draft',
        title: `${queryToken} image adoption draft`,
      },
      overrideAccess: true,
      req,
    })
    createdContentIDs.push(content.id)

    const adopted = await adoptContentStudioImage({
      id: content.id,
      input: { mediaId: media.id, updatedAt: content.updatedAt },
      payload: payload as unknown as ContentStudioPayload,
      req,
    })
    expect(adopted).toMatchObject({ id: content.id, status: 'draft' })
    const stored = await payload.findByID({ collection: 'generated-contents', depth: 0, id: content.id, overrideAccess: true })
    expect(stored.assets).toEqual([media.id])

    const page = await loadContentStudioPageData({
      env: { ADMIN_PORTAL_CONTENT_STUDIO_ENABLED: 'true', ADMIN_PORTAL_ENABLED: 'true' },
      payload,
      query: parseContentStudioQuery({ q: queryToken }),
      req,
      role: 'operator',
    })
    const option = page.summary?.options.assets.find((asset) => asset.id === media.id)
    expect(option).toMatchObject({ id: media.id, meta: 'image/png' })
    expect(option?.previewUrl).toMatch(/^\/api\/media\/file\//)
  })

  it('returns a forbidden page result for sales before reading Media', async () => {
    const result = await loadMediaPageData({
      env: { ADMIN_PORTAL_ENABLED: 'true', ADMIN_PORTAL_MEDIA_ENABLED: 'true' },
      payload,
      query: {
        kind: 'all',
        page: 1,
        q: queryToken,
        source: '',
        view: 'grid',
        visibility: 'all',
      },
      req: await requestFor(sales),
      role: 'sales',
    })

    expect(result).toEqual({ state: 'forbidden', summary: null })
  })
})
