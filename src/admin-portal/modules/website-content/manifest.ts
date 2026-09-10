import { definePortalModule } from '@/admin-portal/core/modules/definePortalModule'

export const WEBSITE_CONTENT_MODULE = definePortalModule({
  id: 'content',
  owner: 'jueyunai',
  navGroup: 'content',
  href: '/dashboard/content',
  labelKey: 'content',
  allowedRoles: ['admin', 'operator'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_WEBSITE_CONTENT_ENABLED',
  commands: ['content:create', 'content:update', 'content:delete'],
  maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'content' },
})
