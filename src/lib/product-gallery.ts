import type { Media } from '@/payload-types'

import { isImageMedia } from './media'

const mediaIdentity = (media: Media): string => String(media.id ?? media.url ?? media.filename)

export const normalizeProductGallery = (
  coverImage: Media | number | null | undefined,
  gallery: Array<Media | number> | null | undefined,
): Media[] => {
  const identities = new Set<string>()
  const images: Media[] = []

  for (const candidate of [coverImage, ...(gallery ?? [])]) {
    if (!isImageMedia(candidate) || !candidate.url) continue

    const identity = mediaIdentity(candidate)
    if (identities.has(identity)) continue

    identities.add(identity)
    images.push(candidate)
  }

  return images
}
