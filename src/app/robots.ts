import type { MetadataRoute } from 'next'

import { absoluteURL, getSiteOrigin } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  const origin = getSiteOrigin()
  return {
    rules: {
      allow: '/',
      disallow: ['/admin', '/admin/', '/api', '/api/', '/dashboard', '/dashboard/'],
      userAgent: '*',
    },
    sitemap: absoluteURL('/sitemap.xml', origin),
  }
}
