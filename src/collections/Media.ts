import { ValidationError, type CollectionBeforeOperationHook, type CollectionConfig } from 'payload'

import {
  contentAdmin,
  contentCreate,
  contentDelete,
  contentUpdate,
  publicMediaRead,
} from '../access/content'
import { revalidateMediaAfterChange, revalidateMediaAfterDelete } from '../hooks/revalidateContent'

export const MEDIA_IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const MEDIA_PDF_MAX_BYTES = 20 * 1024 * 1024
export const MEDIA_MIME_TYPES = [
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

const validateMediaFile: CollectionBeforeOperationHook = ({ operation, req }) => {
  if ((operation !== 'create' && operation !== 'update') || !req.file) {
    return
  }

  const { mimetype, size } = req.file
  const isAllowedMimeType = MEDIA_MIME_TYPES.some((allowed) => allowed === mimetype)

  if (!isAllowedMimeType) {
    throw new ValidationError({
      collection: 'media',
      errors: [
        {
          message: 'Only AVIF, JPEG, PNG, WebP, and PDF files are allowed.',
          path: 'file',
        },
      ],
      req,
    })
  }

  const maximumSize = mimetype === 'application/pdf' ? MEDIA_PDF_MAX_BYTES : MEDIA_IMAGE_MAX_BYTES

  if (size > maximumSize) {
    const maximumMegabytes = maximumSize / 1024 / 1024

    throw new ValidationError({
      collection: 'media',
      errors: [
        {
          message: `File size must not exceed ${maximumMegabytes} MB.`,
          path: 'file',
        },
      ],
      req,
    })
  }
}

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    admin: contentAdmin,
    create: contentCreate,
    delete: contentDelete,
    read: publicMediaRead,
    update: contentUpdate,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
    {
      name: 'source',
      type: 'text',
      admin: {
        description: 'Copyright owner, license, or source reference for this asset.',
      },
      required: true,
    },
    {
      name: 'isPublic',
      type: 'checkbox',
      admin: {
        description: 'Allow anonymous website visitors to read and download this asset.',
      },
      defaultValue: false,
    },
  ],
  hooks: {
    afterChange: [revalidateMediaAfterChange],
    afterDelete: [revalidateMediaAfterDelete],
    beforeOperation: [validateMediaFile],
  },
  upload: {
    adminThumbnail: 'thumbnail',
    focalPoint: true,
    imageSizes: [
      {
        fit: 'cover',
        height: 300,
        name: 'thumbnail',
        position: 'centre',
        width: 400,
        withoutEnlargement: true,
      },
      {
        fit: 'cover',
        height: 576,
        name: 'card',
        position: 'centre',
        width: 768,
        withoutEnlargement: true,
      },
      {
        name: 'large',
        width: 1600,
        withoutEnlargement: true,
      },
    ],
    mimeTypes: [...MEDIA_MIME_TYPES],
    resizeOptions: {
      fit: 'inside',
      height: 2400,
      width: 2400,
      withoutEnlargement: true,
    },
    withMetadata: false,
  },
}
