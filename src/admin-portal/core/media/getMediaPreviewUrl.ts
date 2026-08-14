export interface MediaPreviewProjection {
  mimeType?: null | string
  sizes?: {
    card?: { url?: null | string } | null
    thumbnail?: { url?: null | string } | null
  } | null
  thumbnailURL?: null | string
  url?: null | string
}

export const safeMediaUrl = (value: null | string | undefined): null | string => {
  if (!value || value.includes('\\')) return null
  if (value.startsWith('/') && !value.startsWith('//')) return value

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export const getMediaPreviewUrl = (document: MediaPreviewProjection): null | string => {
  if (!document.mimeType?.startsWith('image/')) return null
  return (
    safeMediaUrl(document.sizes?.card?.url) ??
    safeMediaUrl(document.sizes?.thumbnail?.url) ??
    safeMediaUrl(document.thumbnailURL) ??
    safeMediaUrl(document.url)
  )
}
