import type { GlobalConfig } from 'payload'

import { seoField } from '../fields/seo'

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  admin: {
    group: 'Website Settings',
  },
  fields: [
    {
      name: 'siteName',
      type: 'text',
      localized: true,
      required: true,
    },
    {
      name: 'siteDescription',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'footerText',
      type: 'textarea',
      localized: true,
    },
    {
      name: 'logo',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'navigation',
      type: 'array',
      fields: [
        {
          name: 'label',
          type: 'text',
          localized: true,
          required: true,
        },
        {
          name: 'page',
          type: 'relationship',
          relationTo: 'pages',
          required: true,
        },
      ],
    },
    {
      name: 'contact',
      type: 'group',
      fields: [
        {
          name: 'email',
          type: 'email',
        },
        {
          name: 'phone',
          type: 'text',
        },
        {
          name: 'whatsapp',
          type: 'text',
        },
        {
          name: 'address',
          type: 'textarea',
          localized: true,
        },
      ],
    },
    {
      name: 'socialLinks',
      type: 'array',
      fields: [
        {
          name: 'platform',
          type: 'select',
          options: [
            { label: 'Facebook', value: 'facebook' },
            { label: 'Instagram', value: 'instagram' },
            { label: 'LinkedIn', value: 'linkedin' },
            { label: 'TikTok', value: 'tiktok' },
            { label: 'YouTube', value: 'youtube' },
            { label: 'Other', value: 'other' },
          ],
          required: true,
        },
        {
          name: 'url',
          type: 'text',
          required: true,
        },
      ],
    },
    seoField('defaultSeo'),
  ],
}
