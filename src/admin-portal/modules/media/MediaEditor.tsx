'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'
import { IconDeviceFloppy, IconEdit, IconTrash, IconUpload, IconX } from '@tabler/icons-react'

import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, StatusBadge } from '@/admin-portal/core/ui'

import type { MediaSummaryItem } from './getMediaPage'

type MediaEditorMode = 'create' | 'edit'

const copy = {
  en: {
    alt: 'Alternative text',
    cancel: 'Cancel',
    confirmDelete: 'Delete permanently',
    create: 'Upload asset',
    delete: 'Delete',
    deleteWarning: 'Deletion is blocked while this asset is referenced by content or settings.',
    edit: 'Edit metadata',
    error: 'The asset change could not be saved.',
    file: 'File',
    isPublic: 'Publicly readable',
    save: 'Save metadata',
    saved: 'Asset metadata saved.',
    source: 'Copyright / source',
    upload: 'Upload asset',
  },
  zh: {
    alt: '替代文本 alt',
    cancel: '取消',
    confirmDelete: '确认永久删除',
    create: '上传素材',
    delete: '删除',
    deleteWarning: '素材被内容或站点设置引用时，系统会阻止删除。',
    edit: '编辑元数据',
    error: '本次素材变更未能保存。',
    file: '文件',
    isPublic: '允许公开读取',
    save: '保存元数据',
    saved: '素材元数据已保存。',
    source: '版权 / 来源',
    upload: '上传素材',
  },
} as const

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } }
    return typeof body.error?.message === 'string' ? body.error.message : fallback
  } catch {
    return fallback
  }
}

export function MediaEditor({
  item,
  mode,
  onClose,
}: {
  item: MediaSummaryItem | null
  mode: MediaEditorMode
  onClose: () => void
}) {
  const router = useRouter()
  const { locale } = usePortalPreferences()
  const text = copy[locale]
  const [alt, setAlt] = useState(() => item?.alt ?? '')
  const [source, setSource] = useState(() => item?.source ?? '')
  const [isPublic, setIsPublic] = useState(() => item?.isPublic ?? false)
  const [updatedAt, setUpdatedAt] = useState(() => item?.updatedAt ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [createKey] = useState(() => `portal-media:${crypto.randomUUID()}`)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState<null | { tone: 'danger' | 'success'; value: string }>(null)

  const save = async () => {
    if (mode === 'create' && !file) {
      setNotice({
        tone: 'danger',
        value: locale === 'zh' ? '请选择要上传的文件。' : 'Choose a file to upload.',
      })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      let response: Response
      if (mode === 'create' && file) {
        const form = new FormData()
        form.set('alt', alt)
        form.set('source', source)
        form.set('isPublic', String(isPublic))
        form.set('file', file)
        response = await fetch('/api/portal/media', {
          body: form,
          headers: { 'Idempotency-Key': createKey },
          method: 'POST',
        })
      } else if (item) {
        response = await fetch(`/api/portal/media/${item.id}`, {
          body: JSON.stringify({ alt, isPublic, source, updatedAt }),
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `portal-media:${crypto.randomUUID()}`,
          },
          method: 'PATCH',
        })
      } else {
        throw new Error(text.error)
      }

      if (!response.ok) throw new Error(await errorMessage(response, text.error))
      const body = (await response.json()) as { result?: { updatedAt?: string } }
      if (typeof body.result?.updatedAt === 'string') setUpdatedAt(body.result.updatedAt)
      router.refresh()
      if (mode === 'create') onClose()
      else setNotice({ tone: 'success', value: text.saved })
    } catch (error) {
      setNotice({ tone: 'danger', value: error instanceof Error ? error.message : text.error })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!item) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/portal/media/${item.id}`, {
        body: JSON.stringify({ updatedAt }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `portal-media:${crypto.randomUUID()}`,
        },
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await errorMessage(response, text.error))
      router.refresh()
      onClose()
    } catch (error) {
      setNotice({ tone: 'danger', value: error instanceof Error ? error.message : text.error })
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="portal-media-editor"
      aria-label={mode === 'create' ? text.create : text.edit}
    >
      <header className="portal-media-editor__header">
        <div>
          <p>{mode === 'create' ? text.upload : item?.filename}</p>
          <h3>{mode === 'create' ? text.create : text.edit}</h3>
        </div>
        <Button aria-label={text.cancel} onClick={onClose} size="icon" variant="ghost">
          <IconX aria-hidden="true" size={18} />
        </Button>
      </header>

      {notice ? <StatusBadge label={notice.value} tone={notice.tone} /> : null}

      <div className="portal-media-editor__fields">
        {mode === 'create' ? (
          <label className="portal-media-editor__field">
            <span>{text.file}</span>
            <input
              accept="image/avif,image/jpeg,image/png,image/webp,application/pdf"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
              type="file"
            />
          </label>
        ) : null}
        <label className="portal-media-editor__field">
          <span>{text.alt}</span>
          <input
            disabled={busy}
            maxLength={500}
            onChange={(event) => setAlt(event.target.value)}
            required
            value={alt}
          />
        </label>
        <label className="portal-media-editor__field">
          <span>{text.source}</span>
          <textarea
            disabled={busy}
            maxLength={2000}
            onChange={(event) => setSource(event.target.value)}
            required
            rows={4}
            value={source}
          />
        </label>
        <label className="portal-media-editor__checkbox">
          <input
            checked={isPublic}
            disabled={busy}
            onChange={(event) => setIsPublic(event.target.checked)}
            type="checkbox"
          />
          <span>{text.isPublic}</span>
        </label>
      </div>

      <footer className="portal-media-editor__actions">
        <Button disabled={busy} onClick={() => void save()}>
          {mode === 'create' ? (
            <IconUpload aria-hidden="true" size={16} />
          ) : (
            <IconDeviceFloppy aria-hidden="true" size={16} />
          )}
          {mode === 'create' ? text.upload : text.save}
        </Button>
        {mode === 'edit' && item ? (
          confirmDelete ? (
            <>
              <span className="portal-media-editor__delete-warning">{text.deleteWarning}</span>
              <Button disabled={busy} onClick={() => void remove()} variant="danger">
                <IconTrash aria-hidden="true" size={16} />
                {text.confirmDelete}
              </Button>
              <Button disabled={busy} onClick={() => setConfirmDelete(false)} variant="ghost">
                {text.cancel}
              </Button>
            </>
          ) : (
            <Button disabled={busy} onClick={() => setConfirmDelete(true)} variant="ghost">
              <IconTrash aria-hidden="true" size={16} />
              {text.delete}
            </Button>
          )
        ) : null}
      </footer>
    </section>
  )
}

export function MediaEditorButton({ onClick }: { onClick: () => void }) {
  const { locale } = usePortalPreferences()
  return (
    <Button onClick={onClick} variant="secondary">
      <IconEdit aria-hidden="true" size={16} />
      {copy[locale].edit}
    </Button>
  )
}
