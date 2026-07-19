import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Payload } from 'payload'

import type { Conversation, User, VisitorSession } from '@/payload-types'

import { ChatServiceError } from './contracts'

export const CHAT_SESSION_COOKIE = 'ivybm_chat_session'

export const createVisitorToken = (idempotencyKey: string): string => {
  const secret = process.env.PAYLOAD_SECRET || 'local-development-only-secret-change-me'
  return createHmac('sha256', secret).update(`chat-session:${idempotencyKey}`).digest('base64url')
}
export const hashVisitorToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

const relationshipID = (value: number | { id: number }): number =>
  typeof value === 'number' ? value : value.id

export const authorizeVisitorSession = async (
  payload: Payload,
  conversationPublicId: string,
  token: string | undefined,
): Promise<Conversation> => {
  if (!token) throw new ChatServiceError('forbidden', 'Chat session authorization is required')
  const conversations = await payload.find({
    collection: 'conversations',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { publicId: { equals: conversationPublicId } },
  })
  const conversation = conversations.docs[0]
  if (!conversation) throw new ChatServiceError('not_found', 'Chat session not found')
  const visitor = await payload.findByID({
    collection: 'visitor-sessions',
    id: relationshipID(conversation.visitorSession),
    overrideAccess: true,
  }) as VisitorSession
  const supplied = Buffer.from(hashVisitorToken(token), 'hex')
  const stored = Buffer.from(visitor.sessionTokenHash, 'hex')
  if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) {
    throw new ChatServiceError('forbidden', 'Chat session authorization failed')
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
