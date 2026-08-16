const SECRET_KEYS =
  /(?:password|passphrase|cookie|token|authorization|secret|api[-_]?key|credential|private[-_]?key|sha(?:256)?|hash)/i
const PATH_KEYS = /(?:path|filepath|file_path|source|absolute)/i
const CONTENT_KEYS = /(?:body|prompt|original|raw|content|description|response)/i
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g
const ABSOLUTE_PATH = /(?:\/Users\/|\/private\/|\/tmp\/|\/var\/|[A-Za-z]:\\)[^\s)]+/g

const redactString = (value: string): string => {
  const withoutControls = value.replace(CONTROL_CHARS, '').replace(ABSOLUTE_PATH, '[OMITTED]')
  const trimmed = withoutControls.trim()
  const looksLikeBearer = /^bearer\s+[A-Za-z0-9_./+=-]{16,}$/i.test(trimmed)
  const looksLikeOpaqueSecret =
    trimmed.length >= 32 &&
    /^[A-Za-z0-9_./+=-]+$/.test(trimmed) &&
    /[A-Z]/.test(trimmed) &&
    /[a-z]/.test(trimmed) &&
    /\d/.test(trimmed)
  if (looksLikeBearer || looksLikeOpaqueSecret) {
    return '[REDACTED]'
  }

  return withoutControls.length > 240 ? `${withoutControls.slice(0, 237)}...` : withoutControls
}

export const redactLogValue = (value: unknown, key?: string): unknown => {
  if (key && SECRET_KEYS.test(key)) return '[REDACTED]'
  if (key && (PATH_KEYS.test(key) || CONTENT_KEYS.test(key))) return '[OMITTED]'
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (value instanceof Error) return redactString(value.message)
  if (Array.isArray(value)) return value.map((entry) => redactLogValue(entry))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactLogValue(entryValue, entryKey),
      ]),
    )
  }
  return '[OMITTED]'
}

export const createSafeLogger =
  (write: (line: string) => void = (line) => process.stderr.write(`${line}\n`)) =>
  (event: Record<string, unknown>): void => {
    write(JSON.stringify(redactLogValue(event)))
  }

export const safeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return String(redactLogValue(error.message))
  return 'Import failed'
}
