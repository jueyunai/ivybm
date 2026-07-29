import { definePortalModule } from '@/admin-portal/core/modules/definePortalModule'

export const SETTINGS_MODULE = definePortalModule({
  id: 'settings',
  owner: 'jueyunai',
  navGroup: 'system',
  href: '/dashboard/settings',
  labelKey: 'settings',
  allowedRoles: ['admin', 'operator', 'sales'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_SETTINGS_ENABLED',
  commands: [],
  maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'settings' },
})
