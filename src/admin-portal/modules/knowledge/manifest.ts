import { definePortalModule } from '@/admin-portal/core/modules'

export const KNOWLEDGE_MODULE = definePortalModule({
  id: 'knowledge',
  owner: 'xuemusi',
  navGroup: 'intelligence',
  href: '/dashboard/knowledge',
  labelKey: 'knowledge',
  allowedRoles: ['admin', 'operator'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_KNOWLEDGE_ENABLED',
  commands: [
    'knowledge:create',
    'knowledge:update',
    'knowledge:review',
    'knowledge:archive',
    'knowledge:delete',
    'knowledge:index',
    'knowledge:ai-debug',
  ],
  maintenance: { responsibleOwner: 'xuemusi', nextStepKey: 'knowledge' },
})
