import { describe, expect, it } from 'vitest'

import { POST_CATEGORIES, POST_CONTENT_TYPES, Posts } from '@/collections/Posts'

describe('Posts collection schema with contentType isolation', () => {
  it('defines contentType select field with news and knowledge options defaulting to news', () => {
    const contentTypeField = Posts.fields.find(
      (field) => 'name' in field && field.name === 'contentType',
    )
    expect(contentTypeField).toBeDefined()
    expect(contentTypeField).toMatchObject({
      defaultValue: 'news',
      name: 'contentType',
      required: true,
      type: 'select',
    })

    if (contentTypeField && 'options' in contentTypeField) {
      expect(contentTypeField.options).toEqual([
        { label: 'News', value: 'news' },
        { label: 'Knowledge', value: 'knowledge' },
      ])
    }
  })

  it('includes both news categories and knowledge topics in category select field', () => {
    expect(POST_CONTENT_TYPES).toEqual(['news', 'knowledge'])
    expect(POST_CATEGORIES).toContain('industry')
    expect(POST_CATEGORIES).toContain('products')
    expect(POST_CATEGORIES).toContain('projects')
    expect(POST_CATEGORIES).toContain('company')
    expect(POST_CATEGORIES).toContain('material-comparison')
    expect(POST_CATEGORIES).toContain('technical-guide')
    expect(POST_CATEGORIES).toContain('procurement')
    expect(POST_CATEGORIES).toContain('quality-logistics')

    const categoryField = Posts.fields.find(
      (field) => 'name' in field && field.name === 'category',
    )
    expect(categoryField).toBeDefined()
    expect(categoryField).toMatchObject({
      defaultValue: 'industry',
      name: 'category',
      required: true,
      type: 'select',
    })
  })

  it('includes contentType in default admin columns', () => {
    expect(Posts.admin?.defaultColumns).toContain('contentType')
    expect(Posts.admin?.defaultColumns).toContain('title')
    expect(Posts.admin?.defaultColumns).toContain('category')
  })
})
