type MediaPreviewProjection = {
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

export const mediaPreviewUrl = (document: MediaPreviewProjection): null | string =>
  safeMediaUrl(document.sizes?.card?.url) ??
  safeMediaUrl(document.sizes?.thumbnail?.url) ??
  safeMediaUrl(document.thumbnailURL) ??
  safeMediaUrl(document.url)
