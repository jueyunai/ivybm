import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Payload } from 'payload'

import type { Conversation, User, VisitorSession } from '@/payload-types'

import { ChatServiceError } from './contracts'

export const CHAT_SESSION_COOKIE = 'ivybm_chat_session'
export const CHAT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const CHAT_SESSION_TTL_MS = CHAT_SESSION_TTL_SECONDS * 1_000
const CHAT_PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const CHAT_PUBLIC_ID_MAX_LENGTH = 200

/** A visitor credential is a server-issued secret, never a derivation of client input. */
export const createVisitorToken = (): string => randomBytes(32).toString('base64url')
export const hashVisitorToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')
export const visitorSessionExpiresAt = (now: Date = new Date()): string =>
  new Date(now.getTime() + CHAT_SESSION_TTL_MS).toISOString()

export const isVisitorSessionActive = (expiresAt: string | null | undefined, now = Date.now()): boolean => {
  const timestamp = expiresAt ? Date.parse(expiresAt) : Number.NaN
  return Number.isFinite(timestamp) && timestamp > now
}

const relationshipID = (value: number | { id: number } | null | undefined): number | undefined =>
  typeof value === 'number' ? value : value?.id

export const requireChatPublicID = (value: string): string => {
  if (!value || value.length > CHAT_PUBLIC_ID_MAX_LENGTH || !CHAT_PUBLIC_ID_PATTERN.test(value)) {
    throw new ChatServiceError('invalid_request', 'Chat session identifier is invalid')
  }
  return value
}

const findConversation = async (
  payload: Payload,
  conversationPublicId: string,
): Promise<Conversation> => {
  const publicId = requireChatPublicID(conversationPublicId)
  const conversations = await payload.find({
    collection: 'conversations',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { publicId: { equals: publicId } },
  })
  const conversation = conversations.docs[0]
  if (!conversation) throw new ChatServiceError('not_found', 'Chat session not found')
  return conversation
}

export const authorizeVisitorSession = async (
  payload: Payload,
  conversationPublicId: string,
  token: string | undefined,
): Promise<Conversation> => {
  if (!token) throw new ChatServiceError('forbidden', 'Chat session authorization is required')
  const conversation = await findConversation(payload, conversationPublicId)
  const visitorID = relationshipID(conversation.visitorSession)
  if (!visitorID) throw new ChatServiceError('internal_error', 'Chat session is invalid')
  const visitor = await payload.findByID({
    collection: 'visitor-sessions',
    id: visitorID,
    overrideAccess: true,
  }) as VisitorSession
  if (!isVisitorSessionActive(visitor.expiresAt)) {
    throw new ChatServiceError('forbidden', 'Chat session authorization has expired')
  }
  const supplied = Buffer.from(hashVisitorToken(token), 'hex')
  const stored = Buffer.from(visitor.sessionTokenHash, 'hex')
  if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) {
    throw new ChatServiceError('forbidden', 'Chat session authorization failed')
  }
  return conversation
}

/**
 * Operator/admin users may inspect every conversation; sales users only receive
 * the conversation already assigned to them by a privileged takeover command.
 */
export const authorizeOperatorConversation = async (
  payload: Payload,
  conversationPublicId: string,
  actor: User,
): Promise<Conversation> => {
  const conversation = await findConversation(payload, conversationPublicId)
  const assignedTo = relationshipID(conversation.assignedTo)
  if (actor.role === 'sales' && String(assignedTo) !== String(actor.id)) {
    throw new ChatServiceError('forbidden', 'Sales users may view only assigned conversations')
  }
  return conversation
}

export const authenticateOperator = async (payload: Payload, request: Request): Promise<User> => {
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.collection !== 'users') {
    throw new ChatServiceError('forbidden', 'Operator authentication is required')
  }
  const typed = user as User
  if (typed.role !== 'admin' && typed.role !== 'operator' && typed.role !== 'sales') {
    throw new ChatServiceError('forbidden', 'Operator authentication is required')
  }
  return typed
}
