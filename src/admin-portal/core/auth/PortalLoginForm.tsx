'use client'

import { useState, type FormEvent } from 'react'

import { IconLock, IconMail } from '@tabler/icons-react'
import { useRouter } from 'next/navigation'

import { Button } from '../ui'
import { requestPortalLogin, PortalLoginError } from './requestPortalLogin'

const loginErrorMessages: Record<PortalLoginError['code'], string> = {
  'account-locked': '登录尝试次数过多，请稍后再试。',
  'invalid-credentials': '邮箱或密码不正确，请重新输入。',
  'network-failure': '网络连接失败，请检查连接后重试。',
  'service-unavailable': '登录服务暂不可用，请稍后重试。',
}

export function PortalLoginForm({
  fetcher,
  returnTo,
}: {
  fetcher?: typeof fetch
  returnTo: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')

    setError(null)
    setPending(true)
    try {
      await requestPortalLogin({ email, fetcher, password })
      router.replace(returnTo)
      router.refresh()
    } catch (caught) {
      const code = caught instanceof PortalLoginError ? caught.code : 'service-unavailable'
      setError(loginErrorMessages[code])
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="portal-login-form" method="post" noValidate onSubmit={submit}>
      <label className="portal-field">
        <span className="portal-field__label">邮箱</span>
        <span className="portal-field__control">
          <IconMail aria-hidden="true" size={16} stroke={1.8} />
          <input
            autoComplete="username"
            inputMode="email"
            name="email"
            placeholder="operator@ivybm.com"
            required
            type="email"
          />
        </span>
      </label>
      <label className="portal-field">
        <span className="portal-field__label">密码</span>
        <span className="portal-field__control">
          <IconLock aria-hidden="true" size={16} stroke={1.8} />
          <input autoComplete="current-password" minLength={12} name="password" required type="password" />
        </span>
      </label>
      {error ? (
        <p className="portal-login-form__error" role="alert">
          {error}
        </p>
      ) : null}
      <Button aria-busy={pending ? 'true' : undefined} disabled={pending} type="submit">
        {pending ? '正在登录…' : '登录后台'}
      </Button>
    </form>
  )
}
