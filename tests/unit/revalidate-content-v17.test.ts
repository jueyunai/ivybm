import { describe, expect, it } from 'vitest'

import { localizedPaths } from '@/hooks/revalidateContent'

describe('revalidateContent localizedPaths with Knowledge and News content types', () => {
  it('generates knowledge list and detail paths for knowledge posts', () => {
    const paths = localizedPaths('posts', {
      contentType: 'knowledge',
      slug: 'double-curved-panel-fabrication',
    })

    expect(paths).toContain('/en/knowledge')
    expect(paths).toContain('/en/knowledge/double-curved-panel-fabrication')
    expect(paths).toContain('/ar/knowledge')
    expect(paths).toContain('/ar/knowledge/double-curved-panel-fabrication')

    // Must NOT contain news paths
    expect(paths).not.toContain('/en/news')
    expect(paths).not.toContain('/en/news/double-curved-panel-fabrication')
  })

  it('generates news list and detail paths for news posts', () => {
    const paths = localizedPaths('posts', {
      contentType: 'news',
      slug: 'saudi-expo-expansion',
    })

    expect(paths).toContain('/en/news')
    expect(paths).toContain('/en/news/saudi-expo-expansion')
    expect(paths).toContain('/ar/news')
    expect(paths).toContain('/ar/news/saudi-expo-expansion')

    // Must NOT contain knowledge paths
    expect(paths).not.toContain('/en/knowledge')
    expect(paths).not.toContain('/en/knowledge/saudi-expo-expansion')
  })

  it('defaults to news paths when contentType is undefined for legacy compatibility', () => {
    const paths = localizedPaths('posts', {
      slug: 'legacy-article',
    })

    expect(paths).toContain('/en/news')
    expect(paths).toContain('/en/news/legacy-article')
    expect(paths).toContain('/ar/news')
    expect(paths).toContain('/ar/news/legacy-article')
  })
})
