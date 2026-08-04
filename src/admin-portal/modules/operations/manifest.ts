import { definePortalModule } from '@/admin-portal/core/modules'

export const OPERATIONS_MODULE = definePortalModule({
  id: 'operations',
  owner: 'jueyunai',
  navGroup: 'operations',
  href: '/dashboard/operations',
  labelKey: 'operations',
  allowedRoles: ['admin'],
  availability: 'admin-only',
  featureFlag: 'ADMIN_PORTAL_OPERATIONS_ENABLED',
  commands: ['operations:retry'],
  maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'operations' },
})
