import {
  ChatServiceError,
  type ChatAllowedAction,
  type HandoffStatus,
} from './contracts'

export type HandoffCommand = 'request' | 'resolve' | 'take_over'

const transitions: Record<HandoffStatus, Partial<Record<HandoffCommand, HandoffStatus>>> = {
  ai_active: { request: 'handoff_requested' },
  handoff_requested: { take_over: 'human_active' },
  human_active: { resolve: 'resolved' },
  resolved: {},
}

export const transitionHandoff = (
  current: HandoffStatus,
  command: HandoffCommand,
): HandoffStatus => {
  const next = transitions[current][command]
  if (!next) {
    throw new ChatServiceError(
      'conflict',
      `Illegal handoff transition: ${current} --${command}-->`,
    )
  }
  return next
}

export const assertAiReplyAllowed = (status: HandoffStatus): void => {
  if (status !== 'ai_active') {
    throw new ChatServiceError('handoff_required', 'AI replies are disabled for this conversation')
  }
}

export type ChatSessionViewer = 'operator' | 'sales' | 'visitor'

/**
 * A snapshot only advertises commands the current caller can issue. The visitor and
 * operator views intentionally differ so browser UI cannot infer authority from state alone.
 */
export const allowedActionsFor = (
  status: HandoffStatus,
  viewer: ChatSessionViewer = 'visitor',
): ChatAllowedAction[] => {
  switch (status) {
    case 'ai_active':
      return viewer === 'visitor' ? ['send_message', 'request_handoff'] : []
    case 'handoff_requested':
      return viewer === 'operator' ? ['take_over'] : []
    case 'human_active':
      return viewer === 'operator' || viewer === 'sales'
        ? ['send_operator_message', 'resolve']
        : ['send_message']
    case 'resolved':
      return []
  }
}
