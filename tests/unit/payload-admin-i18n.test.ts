import { describe, expect, it } from 'vitest'

import config from '@/payload.config'

describe('Payload Admin interface localization', () => {
  it('defaults the Admin interface to Simplified Chinese while retaining English and public content locales', async () => {
    const payloadConfig = await config
    const localization = payloadConfig.localization
    const { en, zh } = payloadConfig.i18n.supportedLanguages

    if (!localization) throw new Error('Public content localization must remain enabled')
    if (!zh || !en) throw new Error('Admin interface languages must be configured')

    expect(payloadConfig.i18n.fallbackLanguage).toBe('zh')
    expect(Object.keys(payloadConfig.i18n.supportedLanguages)).toEqual(['zh', 'en'])
    expect(zh.translations.general.thisLanguage).toBe('中文 (简体)')
    expect(en.translations.general.thisLanguage).toBe('English')
    expect(localization.defaultLocale).toBe('en')
    expect(localization.locales.map(({ code }) => code)).toEqual(['en', 'ar'])
  })
})
