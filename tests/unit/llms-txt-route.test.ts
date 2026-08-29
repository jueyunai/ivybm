import { describe, expect, it } from 'vitest'

import { GET } from '@/app/llms.txt/route'

describe('public GET /llms.txt endpoint', () => {
  it('returns a successful plain text response with static caching headers', async () => {
    const response = GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('cache-control')).toContain('public')
    expect(response.headers.get('cache-control')).toContain('max-age=3600')

    const text = await response.text()
    expect(text).toContain('# IVYBM')
    expect(text).toContain('facade engineering and architectural metalwork services')
  })

  it('includes core capability statements and inquiry workflow guidance', async () => {
    const response = GET()
    const text = await response.text()

    expect(text).toContain('## What IVYBM does')
    expect(text).toContain('design development, fabrication coordination, mock-up and quality verification')
    expect(text).toContain('BOQ files, and 3D references submitted through the inquiry form')

    expect(text).toContain('## How to contact IVYBM')
    expect(text).toContain('website inquiry form')
    expect(text).toContain('sales workflow for human follow-up')
  })

  it('enforces strict anti-hallucination and accuracy boundaries', async () => {
    const response = GET()
    const text = await response.text()

    expect(text).toContain('## Source and accuracy policy')
    expect(text).toContain('Do not infer certifications, tolerances, prices, lead times, warranty terms, or project credentials')
    expect(text).toContain('For a project decision, request the latest written confirmation from IVYBM')
  })

  it('lists public multilingual navigation paths', async () => {
    const response = GET()
    const text = await response.text()

    expect(text).toContain('## Public website')
    expect(text).toContain('English: /')
    expect(text).toContain('Arabic: /ar/')
    expect(text).toContain('Products: /en/products')
    expect(text).toContain('Projects: /en/projects')
    expect(text).toContain('Contact: /en/contact')
  })
})
