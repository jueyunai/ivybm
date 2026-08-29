export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; retryAfterSeconds: number }

export type RateLimiter = {
  consume: (key: string) => RateLimitResult
}

type FixedWindowRateLimiterOptions = {
  limit: number
  maxKeys?: number
  now?: () => number
  windowMs: number
}

type WindowEntry = {
  count: number
  resetAt: number
}

export const createFixedWindowRateLimiter = ({
  limit,
  maxKeys = 10_000,
  now = Date.now,
  windowMs,
}: FixedWindowRateLimiterOptions): RateLimiter => {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Rate limit must be a positive integer')
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new Error('Rate limit key cap must be positive')
  if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error('Rate limit window must be positive')

  const windows = new Map<string, WindowEntry>()

  return {
    consume(key) {
      const currentTime = now()
      const existing = windows.get(key)
      if (!existing && windows.size >= maxKeys) {
        for (const [storedKey, storedEntry] of windows) {
          if (storedEntry.resetAt <= currentTime) windows.delete(storedKey)
        }
        if (windows.size >= maxKeys) {
          const oldestKey = windows.keys().next().value
          if (oldestKey) windows.delete(oldestKey)
        }
      }
      const entry = !existing || existing.resetAt <= currentTime
        ? { count: 0, resetAt: currentTime + windowMs }
        : existing

      if (entry.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1_000)),
        }
      }

      entry.count += 1
      windows.set(key, entry)

      return { allowed: true, remaining: limit - entry.count }
    },
  }
}

export const inquiryRateLimiter = createFixedWindowRateLimiter({
  limit: 5,
  windowMs: 10 * 60 * 1_000,
})

export const inquiryAttachmentRateLimiter = createFixedWindowRateLimiter({
  limit: 30,
  windowMs: 10 * 60 * 1_000,
})
