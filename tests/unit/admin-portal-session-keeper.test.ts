import React from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PortalSessionKeeper } from '@/admin-portal/core/auth/PortalSessionKeeper'

const MINUTE = 60 * 1000
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const renderPage = (fetcher: typeof fetch, locale: 'en' | 'zh' = 'zh') =>
  render(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(PortalSessionKeeper, { fetcher, locale }),
      React.createElement('input', { 'aria-label': '案例标题', defaultValue: '未保存的案例' }),
    ),
  )

describe('Portal session keeper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T07:02:32Z'))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('refreshes on entry using only the native same-origin HttpOnly session', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    renderPage(fetcher)
    await advance(0)

    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/users/refresh-token', {
      cache: 'no-store',
      credentials: 'same-origin',
      method: 'POST',
      signal: expect.any(AbortSignal),
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps refreshing during editing beyond the former two-hour deadline without clearing input', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    renderPage(fetcher)
    await advance(0)
    const input = screen.getByLabelText('案例标题') as HTMLInputElement

    for (let round = 0; round < 5; round += 1) {
      await advance(29 * MINUTE)
      fireEvent.input(input, { target: { value: `案例编辑第 ${round + 1} 次` } })
      fireEvent.keyDown(input, { key: 'a' })
      expect(fetcher).toHaveBeenCalledTimes(round + 1)
      await advance(MINUTE)
      expect(fetcher).toHaveBeenCalledTimes(round + 2)
    }

    expect(input.value).toBe('案例编辑第 5 次')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not keep an idle visible page alive, and refreshes when editing resumes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    renderPage(fetcher)
    await advance(2 * 60 * MINUTE)

    expect(fetcher).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(screen.getByLabelText('案例标题'))
    await advance(0)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('suspends background refreshes and checks immediately when the page becomes visible', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    renderPage(fetcher)
    await advance(0)
    visibility.mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))
    fireEvent.input(screen.getByLabelText('案例标题'))
    await advance(60 * MINUTE)
    expect(fetcher).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    await advance(0)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not start a refresh until a prerendered hidden page becomes visible', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    renderPage(fetcher)
    await advance(0)
    expect(fetcher).not.toHaveBeenCalled()

    visibility.mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    await advance(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not issue concurrent refreshes during rapid input, scrolling or focus events', async () => {
    let resolve: (response: Response) => void = () => {
      throw new Error('No pending request')
    }
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    renderPage(fetcher)

    for (let i = 0; i < 5; i += 1) {
      fireEvent.input(screen.getByLabelText('案例标题'))
      fireEvent.scroll(document)
      fireEvent(window, new Event('focus'))
    }
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolve(new Response(null, { status: 200 }))
    })
    fireEvent.pointerDown(document)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(['network', 'server'] as const)(
    'retries a temporary %s failure without reporting expiry',
    async (failure) => {
      const fetcher = vi.fn<typeof fetch>()
      if (failure === 'network') fetcher.mockRejectedValueOnce(new Error('offline'))
      else fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }))
      fetcher.mockResolvedValue(new Response(null, { status: 200 }))
      renderPage(fetcher)
      await advance(0)

      fireEvent.input(screen.getByLabelText('案例标题'))
      fireEvent(window, new Event('online'))
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alert')).toBeNull()
      await advance(MINUTE)
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('alert')).toBeNull()
    },
  )

  it('aborts a stalled refresh and retries instead of blocking all future refreshes', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      )
      .mockResolvedValue(new Response(null, { status: 200 }))
    renderPage(fetcher)
    const signal = fetcher.mock.calls[0][1]?.signal

    await advance(15_000)
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
    await advance(45_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403])(
    'preserves editing on HTTP %s and offers login in another tab without retrying writes',
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }))
      const href = window.location.href
      renderPage(fetcher)
      await advance(0)

      expect(screen.getByRole('alert').textContent).toContain('登录状态已失效')
      const link = screen.getByRole('link', { name: '在新标签页重新登录' })
      expect(link.getAttribute('href')).toBe('/dashboard/login')
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect((screen.getByLabelText('案例标题') as HTMLInputElement).value).toBe('未保存的案例')
      expect(window.location.href).toBe(href)

      await advance(60 * MINUTE)
      fireEvent.input(screen.getByLabelText('案例标题'))
      await advance(0)
      expect(fetcher).toHaveBeenCalledTimes(1)
    },
  )

  it('clears the expiry notice on return after signing in without remounting the editor', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValue(new Response(null, { status: 200 }))
    renderPage(fetcher)
    await advance(0)
    const input = screen.getByLabelText('案例标题') as HTMLInputElement
    fireEvent.input(input, { target: { value: '原页面案例内容' } })

    fireEvent(window, new Event('focus'))
    await advance(0)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('案例标题')).toBe(input)
    expect(input.value).toBe('原页面案例内容')
    fireEvent(window, new Event('focus'))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('renders the expiry notice in the selected Portal language', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }))
    renderPage(fetcher, 'en')
    await advance(0)

    expect(screen.getByRole('alert').textContent).toContain('Your session has expired')
    expect(screen.getByRole('link', { name: 'Sign in in a new tab' })).toBeTruthy()
  })

  it('cleans up timers, listeners and the in-flight request on unmount', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    )
    const { unmount } = renderPage(fetcher)
    const signal = fetcher.mock.calls[0][1]?.signal
    unmount()
    await advance(0)

    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.input(document)
    fireEvent(window, new Event('focus'))
    fireEvent(window, new Event('online'))
    fireEvent(document, new Event('visibilitychange'))
    await advance(60 * MINUTE)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
