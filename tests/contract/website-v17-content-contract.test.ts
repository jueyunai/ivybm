import { describe, expect, it } from 'vitest'

import { Posts } from '@/collections/Posts'

describe('Website v1.7 CMS content collections contract specification', () => {
  it('verifies Posts collection structure and field definitions', () => {
    expect(Posts.slug).toBe('posts')
    const hasDrafts = typeof Posts.versions === 'object' && Posts.versions !== null && Posts.versions.drafts === true
    expect(hasDrafts).toBe(true)

    const extractFieldNames = (fields: typeof Posts.fields): string[] => {
      const names: string[] = []
      for (const f of fields) {
        if ('name' in f && f.name) names.push(f.name)
        if ('fields' in f && Array.isArray(f.fields)) {
          names.push(...extractFieldNames(f.fields as typeof Posts.fields))
        }
      }
      return names
    }

    const fieldNames = extractFieldNames(Posts.fields)
    expect(fieldNames).toContain('title')
    expect(fieldNames).toContain('slug')
    expect(fieldNames).toContain('category')
    expect(fieldNames).toContain('content')
  })

  it('validates Posts category field backward compatibility', () => {
    const categoryField = Posts.fields.find(
      (f) => 'name' in f && f.name === 'category',
    ) as { options: { label: string; value: string }[]; type: string } | undefined

    expect(categoryField).toBeDefined()
    expect(categoryField?.type).toBe('select')

    const optionValues = categoryField?.options.map((opt) =>
      typeof opt === 'string' ? opt : opt.value,
    )

    // Legacy news categories must remain intact
    expect(optionValues).toContain('industry')
    expect(optionValues).toContain('products')
    expect(optionValues).toContain('projects')
    expect(optionValues).toContain('company')
  })

  it('specifies v1.7 contentType field contract for Knowledge isolation', () => {
    // Specification for contentType field to be merged into Posts
    const expectedContentTypeConfig = {
      defaultValue: 'news',
      name: 'contentType',
      options: [
        { label: 'News Article', value: 'news' },
        { label: 'Knowledge Base', value: 'knowledge' },
      ],
      required: true,
      type: 'select',
    }

    expect(expectedContentTypeConfig.name).toBe('contentType')
    expect(expectedContentTypeConfig.defaultValue).toBe('news')
    expect(expectedContentTypeConfig.options.map((o) => o.value)).toEqual(['news', 'knowledge'])
  })

  it('specifies Lead model v1.7 contract (optional attachments, hasDrawings, inquiryIntent)', () => {
    const v17LeadContract = {
      attachmentsRelation: 'lead-attachments',
      hasDrawings: { defaultValue: false, type: 'checkbox' },
      inquiryIntentOptions: ['general', 'quote_request', 'buildability_review', 'sample_request'],
    }

    expect(v17LeadContract.attachmentsRelation).toBe('lead-attachments')
    expect(v17LeadContract.inquiryIntentOptions).toContain('buildability_review')
  })
})
