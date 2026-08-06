import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useDocumentInfo: vi.fn(),
  useTranslation: vi.fn(),
}))

vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: mocks.useDocumentInfo,
  useTranslation: mocks.useTranslation,
}))

import PlatformAccountOAuthControls, {
  getMetaOAuthResultMessage,
} from '@/admin/components/PlatformAccountOAuthControls'

describe('PlatformAccountOAuthControls', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    mocks.useTranslation.mockReturnValue({ i18n: { language: 'zh' } })
    mocks.useDocumentInfo.mockReturnValue({
      collectionSlug: 'platform-accounts',
      data: {
        accountKind: 'facebook-page',
        authorization: { accessTokenConfigured: false, state: 'pending' },
        platformFamily: 'meta',
      },
      id: 42,
    })
    window.history.replaceState({}, '', '/admin/collections/platform-accounts/42')
  })

  it('maps stable OAuth results to bilingual operator feedback', () => {
    expect(getMetaOAuthResultMessage('connected', 'zh')).toMatchObject({ tone: 'success' })
    expect(getMetaOAuthResultMessage('required_permission_missing', 'en')).toMatchObject({
      tone: 'error',
    })
    expect(getMetaOAuthResultMessage('unknown', 'zh')).toBeUndefined()
  })

  it('shows a connection action only for saved Meta accounts', () => {
    render(React.createElement(PlatformAccountOAuthControls))

    expect(screen.getByRole('link', { name: '连接 Meta' }).getAttribute('href')).toBe(
      '/api/platforms/meta/oauth/start?accountId=42',
    )

    mocks.useDocumentInfo.mockReturnValue({
      collectionSlug: 'platform-accounts',
      data: { accountKind: 'linkedin-organization', platformFamily: 'linkedin' },
      id: 43,
    })
    const { container } = render(React.createElement(PlatformAccountOAuthControls))
    expect(container.innerHTML).toBe('')
  })

  it('leaves Instagram rendering to its dedicated OAuth control', () => {
    mocks.useDocumentInfo.mockReturnValue({
      collectionSlug: 'platform-accounts',
      data: {
        accountKind: 'instagram-professional',
        authorization: { accessTokenConfigured: false, state: 'pending' },
        platformFamily: 'meta',
      },
      id: 42,
    })

    const view = render(React.createElement(PlatformAccountOAuthControls))

    expect(view.container.innerHTML).toBe('')
  })

  it('shows callback feedback and disconnects through the protected POST route', async () => {
    mocks.useDocumentInfo.mockReturnValue({
      collectionSlug: 'platform-accounts',
      data: {
        accountKind: 'facebook-page',
        authorization: { accessTokenConfigured: true, state: 'connected' },
        platformFamily: 'meta',
      },
      id: 42,
    })
    window.history.replaceState(
      {},
      '',
      '/admin/collections/platform-accounts/42?metaOAuth=connected',
    )
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { accountId: 42, disconnected: true } }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    render(React.createElement(PlatformAccountOAuthControls))

    expect(screen.getByRole('status').textContent).toContain('Meta 账号已成功连接')
    expect(screen.getByRole('link', { name: '重新授权' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '断开授权' }))
    expect(screen.getByText('确定清除当前 Meta Token？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认断开' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(fetcher).toHaveBeenCalledWith('/api/platforms/meta/oauth/disconnect', {
      body: JSON.stringify({ accountId: 42 }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(window.location.pathname).toBe('/admin/collections/platform-accounts/42')
    expect(window.location.search).toBe('?metaOAuth=disconnected')
  })
})
