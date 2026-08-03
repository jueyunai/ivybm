export type LimitedJSONErrorFactory = () => Error

export const readLimitedJSONObject = async (
  request: Request,
  {
    invalid,
    maximumBytes,
    tooLarge,
  }: {
    invalid: LimitedJSONErrorFactory
    maximumBytes: number
    tooLarge: LimitedJSONErrorFactory
  },
): Promise<Record<string, unknown>> => {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw tooLarge()
  if (!request.body) return {}

  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let byteLength = 0
  let limitError: Error | null = null
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.byteLength > maximumBytes - byteLength) {
        await reader.cancel('request body exceeds JSON limit').catch(() => undefined)
        limitError = tooLarge()
        throw limitError
      }
      byteLength += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } catch (error) {
    if (error === limitError) throw error
    throw invalid()
  } finally {
    reader.releaseLock()
  }

  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object')
    return value as Record<string, unknown>
  } catch {
    throw invalid()
  }
}
