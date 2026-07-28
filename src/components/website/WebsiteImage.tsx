import Image from 'next/image'
import React from 'react'

import type { Media } from '@/payload-types'
import { isImageMedia } from '@/lib/media'

type ImageSize = 'card' | 'large' | 'original' | 'thumbnail'

export const getMediaSource = (
  media: Media | number | null | undefined,
  size: ImageSize = 'original',
) => {
  if (!isImageMedia(media)) return null

  const sized = size === 'original' ? undefined : media.sizes?.[size]
  const src = sized?.url || media.url

  if (!src) return null

  return {
    alt: media.alt,
    height: sized?.height || media.height || 900,
    src,
    width: sized?.width || media.width || 1440,
  }
}

export function WebsiteImage({
  alt,
  className,
  fill = false,
  media,
  priority = false,
  sizes,
  type = 'original',
}: {
  alt?: string
  className?: string
  fill?: boolean
  media: Media | number | null | undefined
  priority?: boolean
  sizes?: string
  type?: ImageSize
}) {
  const source = getMediaSource(media, type)

  if (!source) return null

  return fill ? (
    <Image
      alt={alt ?? source.alt}
      className={className}
      fill
      priority={priority}
      sizes={sizes || '100vw'}
      src={source.src}
    />
  ) : (
    <Image
      alt={alt ?? source.alt}
      className={className}
      height={source.height}
      priority={priority}
      sizes={sizes}
      src={source.src}
      width={source.width}
    />
  )
}
