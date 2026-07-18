import type { Where } from 'payload'

export const imageMediaFilter: Where = {
  mimeType: {
    contains: 'image/',
  },
}
