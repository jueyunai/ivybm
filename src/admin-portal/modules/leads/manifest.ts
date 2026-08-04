import { definePortalModule } from '@/admin-portal/core/modules'

export const LEADS_MODULE = definePortalModule({
  id: 'leads',
  owner: 'jueyunai',
  navGroup: 'workspace',
  href: '/dashboard/leads',
  labelKey: 'leads',
  allowedRoles: ['admin', 'operator', 'sales'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_LEADS_ENABLED',
  commands: ['leads:create', 'leads:update', 'leads:delete'],
  maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'leads' },
})
