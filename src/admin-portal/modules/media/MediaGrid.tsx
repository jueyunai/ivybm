'use client'

import { useState } from 'react'

import Image from 'next/image'
import { IconFile, IconFileTypePdf, IconPhoto } from '@tabler/icons-react'

import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { StatusBadge } from '@/admin-portal/core/ui'

import type { MediaSummaryItem, MediaView } from './getMediaPage'

const formatFileSize = (value: null | number): string => {
  if (value === null) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const formatDimensions = (item: MediaSummaryItem): string =>
  item.width && item.height ? `${item.width}×${item.height}` : '—'

const formatType = (item: MediaSummaryItem): string => {
  if (item.kind === 'pdf') return 'PDF'
  if (item.mimeType === 'image/jpeg') return 'JPEG'
  return item.mimeType?.split('/').at(-1)?.toUpperCase() ?? 'FILE'
}

function MediaThumbnail({ item }: { item: MediaSummaryItem }) {
  const [failed, setFailed] = useState(false)

  if (item.kind === 'image' && item.previewUrl && !failed) {
    return (
      <Image
        alt=""
        fill
        onError={() => setFailed(true)}
        sizes="(max-width: 720px) 100vw, 260px"
        src={item.previewUrl}
        unoptimized
      />
    )
  }

  const Icon = item.kind === 'pdf' ? IconFileTypePdf : item.kind === 'image' ? IconPhoto : IconFile
  return <Icon aria-hidden="true" size={32} stroke={1.5} />
}

export function MediaGrid({
  items,
  onSelect,
  selectedId,
  view,
}: {
  items: MediaSummaryItem[]
  onSelect: (id: number | string) => void
  selectedId: null | number | string
  view: MediaView
}) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).mediaWorkspace

  return (
    <ol className={`portal-media__library is-${view}`}>
      {items.map((item) => {
        const active = String(item.id) === String(selectedId)
        return (
          <li key={item.id}>
            <button
              aria-label={`${messages.selectAsset}: ${item.filename}`}
              aria-pressed={active}
              className={`portal-media__asset${active ? ' is-active' : ''}`}
              onClick={() => onSelect(item.id)}
              type="button"
            >
              <span className="portal-media__thumb">
                <span className="portal-media__file-type">{formatType(item)}</span>
                <MediaThumbnail item={item} />
              </span>
              <span className="portal-media__asset-copy">
                <strong title={item.filename}>{item.filename}</strong>
                <span>
                  {formatType(item)} ·{' '}
                  {item.kind === 'image' ? formatDimensions(item) : formatFileSize(item.filesize)}
                </span>
                <StatusBadge
                  label={item.isPublic ? messages.public : messages.private}
                  tone={item.isPublic ? 'success' : 'warning'}
                />
                <small title={item.alt}>{item.alt || messages.noAlt}</small>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export { formatDimensions, formatFileSize, formatType }
