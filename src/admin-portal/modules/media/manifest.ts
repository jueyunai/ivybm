import { definePortalModule } from '@/admin-portal/core/modules/definePortalModule'

export const MEDIA_MODULE = definePortalModule({
  id: 'media',
  owner: 'jueyunai',
  navGroup: 'content',
  href: '/dashboard/media',
  labelKey: 'media',
  allowedRoles: ['admin', 'operator'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_MEDIA_ENABLED',
  commands: ['media:create', 'media:update', 'media:delete'],
  maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'media' },
})
