export const createIntervalGate = (
  intervalMs: number,
  clock: () => number = () => Date.now(),
): (() => boolean) => {
  if (!Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new Error('Maintenance interval must be a positive integer')
  }

  let nextRunAt = 0
  return () => {
    const now = clock()
    if (now < nextRunAt) return false
    nextRunAt = now + intervalMs
    return true
  }
}
