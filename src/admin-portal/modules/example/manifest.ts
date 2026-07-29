import { definePortalModule } from '@/admin-portal/core/modules'

export const EXAMPLE_MODULE = definePortalModule({
  id: 'example',
  owner: 'jueyunai',
  navGroup: 'intelligence',
  href: '/dashboard/example',
  labelKey: 'example',
  allowedRoles: ['admin', 'operator'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_EXAMPLE_ENABLED',
  commands: ['example:refresh'],
  maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'example' },
})
