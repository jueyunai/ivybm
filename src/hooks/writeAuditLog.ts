import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionAfterLoginHook,
  PayloadRequest,
  RequestContext,
} from 'payload'

export type AuditAction = 'create' | 'update' | 'delete' | 'login'

type WriteAuditEntryArgs = {
  action: AuditAction
  context?: RequestContext
  documentId: number | string
  req: PayloadRequest
  resource: string
}

const writeAuditEntry = async ({
  action,
  context,
  documentId,
  req,
  resource,
}: WriteAuditEntryArgs): Promise<void> => {
  if (context?.skipAudit === true) {
    return
  }

  await req.payload.create({
    collection: 'audit-logs',
    context: {
      ...context,
      skipAudit: true,
    },
    data: {
      action,
      actor: req.user?.id,
      documentId: String(documentId),
      resource,
    },
    overrideAccess: true,
    req,
  })
}

export const writeAuditLogAfterChange: CollectionAfterChangeHook = async ({
  collection,
  context,
  doc,
  operation,
  req,
}) => {
  await writeAuditEntry({
    action: operation,
    context,
    documentId: doc.id,
    req,
    resource: collection.slug,
  })

  return doc
}

export const writeAuditLogAfterDelete: CollectionAfterDeleteHook = async ({
  collection,
  context,
  doc,
  req,
}) => {
  await writeAuditEntry({
    action: 'delete',
    context,
    documentId: doc.id,
    req,
    resource: collection.slug,
  })

  return doc
}

export const writeLoginAuditLog: CollectionAfterLoginHook = async ({
  collection,
  context,
  req,
  user,
}) => {
  await writeAuditEntry({
    action: 'login',
    context,
    documentId: user.id,
    req,
    resource: collection.slug,
  })
}
