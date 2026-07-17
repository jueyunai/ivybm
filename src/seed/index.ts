import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../payload.config'

const requireEnvironment = (name: string): string => {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required to seed the database`)
  }

  return value
}

const seed = async (): Promise<void> => {
  const email = requireEnvironment('SEED_ADMIN_EMAIL')
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
        email: {
          equals: email,
        },
      },
    })

    if (existing.totalDocs > 0) {
      payload.logger.info(`Demo administrator already exists: ${email}`)
      return
    }

    await payload.create({
      collection: 'users',
      data: {
        email,
        password,
      },
      overrideAccess: true,
    })

    payload.logger.info(`Created demo administrator: ${email}`)
  } finally {
    await payload.destroy()
  }
}

await seed()
