import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../payload.config'
import { seedContent } from './content'
import { seedKnowledgeDemo } from './knowledgeDemo'
import { seedWebsiteKnowledgeDemo } from './websiteKnowledgeDemo'
import { seedPortalDemo } from './portalDemo'

const requireEnvironment = (name: string): string => {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required to seed the database`)
  }

  return value
}

const normalizeSeedUsername = (value: string): string => {
  const localPart = value.trim().toLowerCase().split('@', 1)[0] ?? ''
  const normalized = localPart
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 64)

  if (normalized.length < 3) {
    throw new Error('SEED_ADMIN_USERNAME or SEED_ADMIN_EMAIL must produce a username with at least 3 characters')
  }

  return normalized
}

const seed = async (): Promise<void> => {
  const configuredUsername = process.env.SEED_ADMIN_USERNAME ?? process.env.SEED_ADMIN_EMAIL
  const username = normalizeSeedUsername(
    configuredUsername ? configuredUsername : requireEnvironment('SEED_ADMIN_USERNAME'),
  )
  const password = requireEnvironment('SEED_ADMIN_PASSWORD')

  if (password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters')
  }

  const payload = await getPayload({
    config,
    disableOnInit: true,
    key: 'database-seed',
  })

  try {
    const existing = await payload.find({
      collection: 'users',
      limit: 1,
      overrideAccess: true,
      where: {
        username: {
          equals: username.toLowerCase(),
        },
      },
    })

    if (existing.totalDocs > 0) {
      payload.logger.info(`Development administrator already exists: ${username}`)
    } else {
      await payload.create({
        collection: 'users',
        draft: true,
        data: {
          password,
          role: 'admin',
          username,
        },
        overrideAccess: true,
      })

      payload.logger.info(`Created development administrator: ${username}`)
    }

    await seedContent(payload)
    if (process.env.SEED_PORTAL_DEMO === 'true') {
      await seedPortalDemo(payload)
    }
    if (process.env.SEED_KNOWLEDGE_DEMO === 'true') {
      await seedKnowledgeDemo(payload)
    }
    if (process.env.SEED_WEBSITE_KNOWLEDGE_DEMO === 'true') {
      await seedWebsiteKnowledgeDemo(payload)
    }
  } finally {
    await payload.destroy()
  }
}

await seed()

// Payload 3.86 leaves its PostgreSQL pool active after destroy(). This is a one-shot CLI.
process.exit(0)
