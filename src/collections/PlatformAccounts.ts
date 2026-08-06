import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  ValidationError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeOperationHook,
  type CollectionConfig,
} from 'payload'

import { platformCredentialRead } from '../access/platformCredentials'
import { accessFor, admins } from '../access/roles'
import { writeAuditLogAfterChange, writeAuditLogAfterDelete } from '../hooks/writeAuditLog'
import {
  decryptPlatformCredential,
  encryptPlatformCredential,
  isEncryptedPlatformCredential,
  readPlatformCredentialEncryptionKey,
} from '../modules/platforms/credentials'
import {
  PLATFORM_ACCOUNT_KINDS,
  PLATFORM_AUTHORIZATION_STATES,
  PLATFORM_CAPABILITY_APPROVAL_STATES,
  derivePlatformConnectionKey,
  isPlatformAccountKind,
  isPlatformAuthorizationState,
  platformFamilyForAccountKind,
} from '../modules/platforms/readiness'

type UnknownRecord = Record<string, unknown>

const requestedAuthorizationContextKey = '__platformAccountRequestedAuthorization'

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {})

const nonEmpty = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

const validationError = (
  req: Parameters<CollectionBeforeChangeHook>[0]['req'],
  message: string,
  path: string,
): ValidationError =>
  new ValidationError({
    collection: 'platform-accounts',
    errors: [{ message, path }],
    req,
  })

const transactionDB = async (req: Parameters<CollectionBeforeChangeHook>[0]['req']) => {
  const transactionID = await req.transactionID
  const adapter = req.payload.db as unknown as PostgresAdapter
  const database = transactionID ? adapter.sessions[transactionID]?.db : undefined
  if (!database) {
    throw validationError(
      req,
      'Platform account updates require an active database transaction',
      'id',
    )
  }
  return database
}

// Payload starts the update transaction before running beforeOperation, while
// originalDoc is read afterwards. The lock must therefore live here rather than
// in beforeChange: a beforeChange lock would serialize the write but still merge
// an originalDoc that was read before a concurrent credential update committed.
const lockPlatformAccountBeforeUpdate: CollectionBeforeOperationHook = async ({
  args,
  operation,
  req,
}) => {
  if (operation !== 'update') return args

  const requestedData = 'data' in args ? asRecord(args.data) : {}
  req.context[requestedAuthorizationContextKey] = asRecord(requestedData.authorization)

  const id = 'id' in args ? args.id : undefined
  if (id === undefined || id === null) {
    throw validationError(
      req,
      'Platform accounts do not support bulk updates because credentials require row serialization',
      'id',
    )
  }

  await (
    await transactionDB(req)
  ).execute(sql`
    SELECT "id" FROM "platform_accounts" WHERE "id" = ${id} FOR UPDATE
  `)
  return args
}

const retainOrReplaceCredential = ({
  clear,
  existing,
  submitted,
}: {
  clear: boolean
  existing: unknown
  submitted: unknown
}): { configured: boolean; value: string | null } => {
  if (clear) return { configured: false, value: null }

  const nextCredential = nonEmpty(submitted)
  const existingCredential = typeof existing === 'string' ? existing : undefined
  if (!nextCredential && !existingCredential) return { configured: false, value: null }

  // Keeping an opaque existing ciphertext during an unrelated metadata update does
  // not require the master key. This is important while an account is merely staged
  // or when a deployment is intentionally configured without credentials. A key is
  // always required before accepting, verifying, or encrypting a newly submitted
  // credential, so neither plaintext nor malformed ciphertext can enter storage.
  // Payload may merge the stored, write-only field back into `data` before this
  // Collection hook runs. Treat that byte-for-byte carry-through exactly like an
  // omitted field: it is not a newly submitted credential.
  if ((!nextCredential || nextCredential === existingCredential) && existingCredential) {
    return { configured: true, value: existingCredential }
  }

  if (!nextCredential) return { configured: false, value: null }

  const encryptionKey = readPlatformCredentialEncryptionKey()

  if (isEncryptedPlatformCredential(nextCredential)) {
    // A Local API operation can re-submit the stored encrypted value. Verify the
    // authentication tag before retaining it so malformed ciphertext never rests in storage.
    decryptPlatformCredential(nextCredential, encryptionKey)
    return { configured: true, value: nextCredential }
  }

  return { configured: true, value: encryptPlatformCredential(nextCredential, encryptionKey) }
}

const normalizeAccountBeforeChange: CollectionBeforeChangeHook = async ({
  context,
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) return data

  const candidate = data as UnknownRecord
  const accountKind = candidate.accountKind ?? originalDoc?.accountKind
  if (!isPlatformAccountKind(accountKind)) return candidate

  const externalAccountId = nonEmpty(candidate.externalAccountId ?? originalDoc?.externalAccountId)
  if (externalAccountId) {
    candidate.externalAccountId = externalAccountId
  } else {
    candidate.externalAccountId = null
  }
  candidate.platformFamily = platformFamilyForAccountKind(accountKind)
  candidate.connectionKey = derivePlatformConnectionKey(accountKind, externalAccountId) ?? null

  const existingAuthorization = asRecord(originalDoc?.authorization)
  const submittedAuthorization = asRecord(candidate.authorization)
  const requestedAuthorization = asRecord(
    context[requestedAuthorizationContextKey] ?? req.data?.authorization,
  )
  const authorization = { ...existingAuthorization, ...submittedAuthorization }
  const submittedAccessToken = nonEmpty(submittedAuthorization.accessToken)
  const existingAccessToken = nonEmpty(existingAuthorization.accessToken)
  const submittedRefreshToken = nonEmpty(submittedAuthorization.refreshToken)
  const existingRefreshToken = nonEmpty(existingAuthorization.refreshToken)
  const connectionIdentityChanged = Boolean(
    originalDoc &&
    (accountKind !== originalDoc.accountKind ||
      externalAccountId !== nonEmpty(originalDoc.externalAccountId)),
  )

  const accessToken = retainOrReplaceCredential({
    clear: submittedAuthorization.clearAccessToken === true,
    existing: existingAuthorization.accessToken,
    submitted: submittedAuthorization.accessToken,
  })
  const refreshToken = retainOrReplaceCredential({
    clear: submittedAuthorization.clearRefreshToken === true,
    existing: existingAuthorization.refreshToken,
    submitted: submittedAuthorization.refreshToken,
  })

  authorization.accessToken = accessToken.value
  authorization.accessTokenConfigured = accessToken.configured
  authorization.clearAccessToken = false
  authorization.clearRefreshToken = false
  authorization.refreshToken = refreshToken.value
  authorization.refreshTokenConfigured = refreshToken.configured

  // A token is scoped to a concrete provider-side account identity. A record
  // without retained credentials can be corrected freely, but never silently
  // carry a retained token over to a different Page, professional account,
  // member, or organization. The administrator must explicitly replace it or
  // clear it and stage the account again; otherwise later promotion to
  // connected could make a stale authorization look valid.
  const replacesAccessToken = Boolean(
    submittedAccessToken && submittedAccessToken !== existingAccessToken,
  )
  const replacesRefreshToken = Boolean(
    submittedRefreshToken && submittedRefreshToken !== existingRefreshToken,
  )
  if (!accessToken.configured || submittedAuthorization.clearAccessToken === true) {
    authorization.expiresAt = null
  } else if (
    operation === 'update' &&
    replacesAccessToken &&
    !Object.prototype.hasOwnProperty.call(requestedAuthorization, 'expiresAt')
  ) {
    authorization.expiresAt = null
  }
  const retainsAccessToken = accessToken.configured && !replacesAccessToken
  const retainsRefreshToken = refreshToken.configured && !replacesRefreshToken
  if (connectionIdentityChanged && (retainsAccessToken || retainsRefreshToken)) {
    throw validationError(
      req,
      'Changing a provider account identity requires replacing or clearing every configured credential first',
      retainsAccessToken ? 'authorization.accessToken' : 'authorization.refreshToken',
    )
  }

  const authorizationState = authorization.state ?? 'not_started'
  if (!isPlatformAuthorizationState(authorizationState)) {
    throw validationError(req, 'Select a valid platform authorization state', 'authorization.state')
  }

  if (authorizationState === 'connected') {
    if (!externalAccountId) {
      throw validationError(
        req,
        'A connected platform account requires an external account ID',
        'externalAccountId',
      )
    }
    if (!accessToken.configured) {
      throw validationError(
        req,
        'A connected platform account requires a configured access token',
        'authorization.accessToken',
      )
    }

    // An existing opaque ciphertext is enough for a harmless metadata update,
    // but not for a state transition that claims the account is usable. A new
    // connected account, or a pending account promoted to connected, must prove
    // that this process has the current master key and can decrypt the retained
    // credential. This prevents readiness from reporting a lost-key deployment
    // as connection-ready.
    if (existingAuthorization.state !== 'connected') {
      const configuredCredential = accessToken.value
      if (!configuredCredential) {
        throw validationError(
          req,
          'A connected platform account requires a valid access token',
          'authorization.accessToken',
        )
      }
      decryptPlatformCredential(configuredCredential, readPlatformCredentialEncryptionKey())
      const configuredRefreshCredential = refreshToken.value
      if (refreshToken.configured && configuredRefreshCredential) {
        decryptPlatformCredential(
          configuredRefreshCredential,
          readPlatformCredentialEncryptionKey(),
        )
      }
    }
  }

  candidate.authorization = authorization
  return candidate
}

export const PlatformAccounts: CollectionConfig = {
  disableBulkEdit: true,
  slug: 'platform-accounts',
  access: {
    admin: admins,
    create: accessFor('platformAccounts', 'create'),
    delete: accessFor('platformAccounts', 'delete'),
    read: accessFor('platformAccounts', 'read'),
    update: accessFor('platformAccounts', 'update'),
  },
  admin: {
    components: {
      edit: {
        beforeDocumentControls: [
          '/admin/components/PlatformAccountOAuthControls',
          '/admin/components/InstagramAccountOAuthControls',
        ],
      },
    },
    defaultColumns: [
      'name',
      'platformFamily',
      'accountKind',
      'externalAccountId',
      'authorization.state',
      'updatedAt',
    ],
    group: 'Platform Accounts',
    useAsTitle: 'name',
  },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true },
    {
      name: 'accountKind',
      type: 'select',
      options: [...PLATFORM_ACCOUNT_KINDS],
      required: true,
    },
    {
      name: 'platformFamily',
      type: 'select',
      admin: { readOnly: true },
      defaultValue: 'meta',
      index: true,
      options: ['meta', 'tiktok', 'linkedin'],
      required: true,
    },
    {
      name: 'externalAccountId',
      type: 'text',
      admin: {
        description:
          'Provider-side Page, professional account, member, or organization identifier. Leave blank until known.',
      },
      index: true,
      maxLength: 240,
    },
    {
      name: 'connectionKey',
      type: 'text',
      access: { create: () => false, update: () => false },
      admin: { hidden: true, readOnly: true },
      unique: true,
    },
    {
      name: 'authorization',
      type: 'group',
      fields: [
        {
          name: 'state',
          type: 'select',
          defaultValue: 'not_started',
          options: [...PLATFORM_AUTHORIZATION_STATES],
          required: true,
        },
        {
          name: 'appId',
          type: 'text',
          admin: {
            description:
              'Non-secret provider application ID. Never enter an App Secret or Client Secret here.',
          },
          maxLength: 240,
        },
        {
          name: 'accessToken',
          type: 'text',
          access: { read: platformCredentialRead },
          admin: {
            description:
              'Write-only. Enter a value to set or replace the token; leave blank to retain it.',
          },
        },
        {
          name: 'accessTokenConfigured',
          type: 'checkbox',
          admin: { readOnly: true },
          defaultValue: false,
        },
        {
          name: 'clearAccessToken',
          type: 'checkbox',
          admin: {
            description:
              'Use only when revoking a credential. A connected account cannot be saved without a token.',
          },
          defaultValue: false,
        },
        {
          name: 'refreshToken',
          type: 'text',
          access: { read: platformCredentialRead },
          admin: {
            description:
              'Write-only. Enter a value to set or replace the refresh token; leave blank to retain it.',
          },
        },
        {
          name: 'refreshTokenConfigured',
          type: 'checkbox',
          admin: { readOnly: true },
          defaultValue: false,
        },
        {
          name: 'clearRefreshToken',
          type: 'checkbox',
          defaultValue: false,
        },
        { name: 'expiresAt', type: 'date' },
        {
          name: 'scopes',
          type: 'array',
          fields: [{ name: 'scope', type: 'text', required: true }],
        },
      ],
    },
    {
      name: 'capabilities',
      type: 'group',
      fields: [
        {
          name: 'messagingInbound',
          type: 'select',
          defaultValue: 'not_started',
          options: [...PLATFORM_CAPABILITY_APPROVAL_STATES],
        },
        {
          name: 'publishing',
          type: 'select',
          defaultValue: 'not_started',
          options: [...PLATFORM_CAPABILITY_APPROVAL_STATES],
        },
      ],
    },
    { name: 'notes', type: 'textarea' },
  ],
  hooks: {
    afterChange: [writeAuditLogAfterChange],
    afterDelete: [writeAuditLogAfterDelete],
    beforeChange: [normalizeAccountBeforeChange],
    beforeOperation: [lockPlatformAccountBeforeUpdate],
  },
}
