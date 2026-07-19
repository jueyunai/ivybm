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

export const allowedActionsFor = (status: HandoffStatus): ChatAllowedAction[] => {
  switch (status) {
    case 'ai_active':
      return ['send_message', 'request_handoff']
    case 'handoff_requested':
      return ['take_over']
    case 'human_active':
      return ['send_message', 'resolve']
    case 'resolved':
      return []
  }
}
