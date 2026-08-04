import { definePortalModule } from '@/admin-portal/core/modules'

export const CONVERSATIONS_MODULE = definePortalModule({
  id: 'conversations',
  owner: 'xuemusi',
  navGroup: 'workspace',
  href: '/dashboard/conversations',
  labelKey: 'conversations',
  allowedRoles: ['admin', 'operator', 'sales'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_CONVERSATIONS_ENABLED',
  commands: [
    'conversations:take-over',
    'conversations:send-operator-message',
    'conversations:resolve',
  ],
  maintenance: { responsibleOwner: 'xuemusi', nextStepKey: 'conversations' },
})
