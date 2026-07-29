import { definePortalModule } from '@/admin-portal/core/modules/definePortalModule'

export const WEBSITE_CONTENT_MODULE = definePortalModule({
  id: 'website-content',
  owner: 'jueyunai',
  navGroup: 'content',
  href: '/dashboard/content',
  labelKey: 'website-content',
  allowedRoles: ['admin', 'operator'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED',
  commands: [],
  maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'website-content' },
})
