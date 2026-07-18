import type { MetadataRoute } from 'next'

import { absoluteURL, getSiteOrigin } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  const origin = getSiteOrigin()
  return {
    rules: { allow: '/', disallow: ['/admin/', '/api/'], userAgent: '*' },
    sitemap: absoluteURL('/sitemap.xml', origin),
  }
}
