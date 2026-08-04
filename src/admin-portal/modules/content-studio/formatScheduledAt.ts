export const formatScheduledAt = (value: string): string => {
  const scheduledAt = new Date(value)

  if (Number.isNaN(scheduledAt.getTime())) return value

  return `${scheduledAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
