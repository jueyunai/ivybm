import type { Media } from '@/payload-types'

export const isImageMedia = (
  media: Media | number | null | undefined,
): media is Media =>
  Boolean(
    media &&
      typeof media === 'object' &&
      (!media.mimeType || media.mimeType.startsWith('image/')),
  )
