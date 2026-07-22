import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.invalid'
const password = process.env.SEED_ADMIN_PASSWORD ?? 'replace-with-local-demo-password'

const reset = async (): Promise<void> => {
  const payload = await getPayload({ config, disableOnInit: true, key: 'reset-admin' })
  try {
    const result = await payload.update({
      collection: 'users',
      where: { email: { equals: email } },
      data: { password },
      overrideAccess: true,
    })
    payload.logger.info(`Reset password for ${result.docs.length} user(s); email=${email}; password length=${password.length}`)
  } finally {
    await payload.destroy()
  }
}

await reset()
process.exit(0)
