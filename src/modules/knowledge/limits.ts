export const KNOWLEDGE_DOCUMENT_MAX_CONTENT_CHARACTERS = 1_000_000

// JSON may escape one UTF-16 code unit as six ASCII bytes (for example, `\u0000`).
// Keep fixed document metadata inside a separate, bounded allowance.
export const KNOWLEDGE_DOCUMENT_MAX_REQUEST_BYTES =
  KNOWLEDGE_DOCUMENT_MAX_CONTENT_CHARACTERS * 6 + 32_768
