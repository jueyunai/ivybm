import { definePortalModule } from '@/admin-portal/core/modules'

export const PLATFORMS_MODULE = definePortalModule({
  id: 'platforms',
  owner: 'xuemusi',
  navGroup: 'operations',
  href: '/dashboard/platforms',
  labelKey: 'platforms',
  allowedRoles: ['admin'],
  availability: 'admin-only',
  featureFlag: 'ADMIN_PORTAL_PLATFORMS_ENABLED',
  commands: [],
  maintenance: { responsibleOwner: 'xuemusi', nextStepKey: 'platforms' },
})
