import { definePortalModule } from '@/admin-portal/core/modules'

export const CONTENT_STUDIO_MODULE = definePortalModule({
  id: 'contentStudio',
  owner: 'jueyunai',
  navGroup: 'content',
  href: '/dashboard/content-studio',
  labelKey: 'contentStudio',
  allowedRoles: ['admin', 'operator'],
  availability: 'available',
  featureFlag: 'ADMIN_PORTAL_CONTENT_STUDIO_ENABLED',
  commands: [
    'contentStudio:create',
    'contentStudio:update',
    'contentStudio:adopt-image',
    'contentStudio:submit-review',
    'contentStudio:review',
    'contentStudio:schedule',
    'contentStudio:publish-now',
    'contentStudio:delete',
  ],
  maintenance: { responsibleOwner: 'jueyunai', nextStepKey: 'contentStudio' },
})
