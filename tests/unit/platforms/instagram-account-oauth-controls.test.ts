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

import InstagramAccountOAuthControls, {
  getInstagramOAuthResultMessage,
} from '@/admin/components/InstagramAccountOAuthControls'

describe('InstagramAccountOAuthControls', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    mocks.useTranslation.mockReturnValue({ i18n: { language: 'zh' } })
    mocks.useDocumentInfo.mockReturnValue({
      collectionSlug: 'platform-accounts',
      data: {
        accountKind: 'instagram-professional',
        authorization: { accessTokenConfigured: false, state: 'pending' },
        platformFamily: 'meta',
      },
      id: 42,
    })
    window.history.replaceState({}, '', '/admin/collections/platform-accounts/42')
  })

  it('maps stable OAuth results to bilingual operator feedback', () => {
    expect(getInstagramOAuthResultMessage('connected', 'zh')).toMatchObject({ tone: 'success' })
    expect(getInstagramOAuthResultMessage('required_permission_missing', 'en')).toMatchObject({
      tone: 'error',
    })
    expect(getInstagramOAuthResultMessage('unknown', 'zh')).toBeUndefined()
  })

  it('shows a connection action only for saved Instagram accounts', () => {
    render(React.createElement(InstagramAccountOAuthControls))

    expect(screen.getByRole('link', { name: '连接 Instagram' }).getAttribute('href')).toBe(
      '/api/platforms/instagram/oauth/start?accountId=42',
    )

    mocks.useDocumentInfo.mockReturnValue({
      collectionSlug: 'platform-accounts',
      data: { accountKind: 'facebook-page', platformFamily: 'meta' },
      id: 43,
    })
    const { container } = render(React.createElement(InstagramAccountOAuthControls))
    expect(container.innerHTML).toBe('')
  })

  it('shows callback feedback and disconnects through the protected POST route', async () => {
    mocks.useDocumentInfo.mockReturnValue({
      collectionSlug: 'platform-accounts',
      data: {
        accountKind: 'instagram-professional',
        authorization: { accessTokenConfigured: true, state: 'connected' },
        platformFamily: 'meta',
      },
      id: 42,
    })
    window.history.replaceState(
      {},
      '',
      '/admin/collections/platform-accounts/42?instagramOAuth=connected',
    )
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { accountId: 42, disconnected: true } }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    render(React.createElement(InstagramAccountOAuthControls))

    expect(screen.getByRole('status').textContent).toContain('Instagram 账号已成功连接')
    expect(screen.getByRole('link', { name: '重新授权' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '断开授权' }))
    expect(screen.getByText('确定清除当前 Instagram Token？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认断开' }))

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(fetcher).toHaveBeenCalledWith('/api/platforms/instagram/oauth/disconnect', {
      body: JSON.stringify({ accountId: 42 }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(window.location.pathname).toBe('/admin/collections/platform-accounts/42')
    expect(window.location.search).toBe('?instagramOAuth=disconnected')
  })
})
