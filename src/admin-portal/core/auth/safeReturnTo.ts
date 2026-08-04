const FALLBACK_PORTAL_PATH = '/dashboard'
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/

const containsUnsafeEncoding = (value: string): boolean => {
  try {
    const decoded = decodeURIComponent(value)
    return (
      decoded.includes('\\') ||
      decoded.includes('//') ||
      CONTROL_CHARACTER_PATTERN.test(decoded)
    )
  } catch {
    return true
  }
}

export const safePortalReturnTo = (value: string | null | undefined): string => {
  if (!value || CONTROL_CHARACTER_PATTERN.test(value) || value.includes('\\')) {
    return FALLBACK_PORTAL_PATH
  }

  if (!value.startsWith('/dashboard') || containsUnsafeEncoding(value)) {
    return FALLBACK_PORTAL_PATH
  }

  try {
    const parsed = new URL(value, 'https://portal.invalid')
    if (parsed.origin !== 'https://portal.invalid') return FALLBACK_PORTAL_PATH
    if (parsed.pathname !== '/dashboard' && !parsed.pathname.startsWith('/dashboard/')) {
      return FALLBACK_PORTAL_PATH
    }
    if (parsed.pathname.split('/').some((segment) => segment === '..' || segment === '.')) {
      return FALLBACK_PORTAL_PATH
    }

    const normalizedPath = parsed.pathname.replace(/\/{2,}/g, '/')
    return `${normalizedPath}${parsed.search}${parsed.hash}`
  } catch {
    return FALLBACK_PORTAL_PATH
  }
}
