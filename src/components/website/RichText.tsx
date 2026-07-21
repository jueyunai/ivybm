import { convertLexicalToHTML } from '@payloadcms/richtext-lexical/html'
import React from 'react'

export function RichText({ data }: { data?: null | Record<string, unknown> }) {
  if (!data) return null

  const html = convertLexicalToHTML({ data: data as never })

  if (!html) return null

  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: html }} />
}
