import { definePortalModule } from '@/admin-portal/core/modules/definePortalModule'

export const OVERVIEW_MODULE = definePortalModule({
  id: 'overview',
  owner: 'jueyunai',
  navGroup: 'workspace',
  href: '/dashboard',
  labelKey: 'overview',
  allowedRoles: ['admin', 'operator', 'sales'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_OVERVIEW_ENABLED',
  commands: [],
  maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'overview' },
})
