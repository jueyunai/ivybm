'use client'

import { useState } from 'react'

import Image from 'next/image'
import { IconExternalLink, IconFileOff, IconFileTypePdf } from '@tabler/icons-react'

import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button } from '@/admin-portal/core/ui'

import type { MediaSummaryItem } from './getMediaPage'

export function MediaPreview({ item }: { item: MediaSummaryItem }) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).mediaWorkspace
  const [failed, setFailed] = useState(false)

  if (item.kind === 'image' && item.previewUrl && !failed) {
    return (
      <div className="portal-media__detail-preview is-image">
        <Image
          alt={item.alt}
          fill
          onError={() => setFailed(true)}
          sizes="320px"
          src={item.previewUrl}
          unoptimized
        />
      </div>
    )
  }

  if (item.kind === 'pdf' && item.previewUrl) {
    return (
      <div className="portal-media__detail-preview is-document">
        <IconFileTypePdf aria-hidden="true" size={42} stroke={1.4} />
        <strong>PDF</strong>
        <Button asChild size="compact" variant="secondary">
          <a href={item.previewUrl} rel="noreferrer" target="_blank">
            <IconExternalLink aria-hidden="true" size={14} stroke={1.8} />
            {messages.previewPdf}
          </a>
        </Button>
      </div>
    )
  }

  return (
    <div className="portal-media__detail-preview is-document">
      <IconFileOff aria-hidden="true" size={38} stroke={1.4} />
      <span>{messages.previewUnavailable}</span>
    </div>
  )
}
