import { definePortalModule } from '@/admin-portal/core/modules'

export const CONTENT_STUDIO_MODULE = definePortalModule({
  id: 'content-studio',
  owner: 'jueyunai',
  navGroup: 'content',
  href: '/dashboard/content-studio',
  labelKey: 'content-studio',
  allowedRoles: ['admin', 'operator'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_CONTENT_STUDIO_ENABLED',
  commands: [
    'content-studio:create',
    'content-studio:update',
    'content-studio:adopt-image',
    'content-studio:submit-review',
    'content-studio:review',
    'content-studio:schedule',
    'content-studio:publish-now',
    'content-studio:delete',
  ],
  maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'content-studio' },
})
