// Shanghai has had no daylight saving since 1991, so a fixed +8 offset keeps the
// rendered timestamp identical on the server and in the browser.
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

export const formatScheduledAt = (value: string): string => {
  const scheduledAt = new Date(value)

  if (Number.isNaN(scheduledAt.getTime())) return value

  return new Date(scheduledAt.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
}
