import { describe, expect, it } from 'vitest'

import { parseSmokeConfig } from '../../../scripts/smoke/config'

describe('parseSmokeConfig', () => {
  const baseValidEnv = {
    SMOKE_PORTAL_EMAIL: 'smoke@example.invalid',
    SMOKE_PORTAL_PASSWORD: 'secret-password-123',
    SMOKE_TARGET_URL: 'http://localhost:3000',
  }

  it('parses valid local configuration with defaults', () => {
    const config = parseSmokeConfig(baseValidEnv, [])

    expect(config).toEqual({
      evidenceMode: 'full',
      feishuTableUrl:
        'https://my.feishu.cn/base/FWqIbgJXVaR4lus7xcScgTblnle?table=tblrmOcSYnilLCIq&view=vewdQVJ7UZ',
      headless: true,
      locales: ['en'],
      outputDir: 'artifacts/live-smoke',
      portalEmail: 'smoke@example.invalid',
      portalPassword: 'secret-password-123',
      scenario: 'all',
      targetUrl: 'http://localhost:3000',
      timeoutMs: 180_000,
    })
  })

  it('fails fast if SMOKE_TARGET_URL is missing', () => {
    expect(() => parseSmokeConfig({ ...baseValidEnv, SMOKE_TARGET_URL: '' }, [])).toThrow(
      /Missing SMOKE_TARGET_URL/u,
    )
  })

  it('fails fast if SMOKE_TARGET_URL has invalid protocol or format', () => {
    expect(() => parseSmokeConfig({ ...baseValidEnv, SMOKE_TARGET_URL: 'not-a-url' }, [])).toThrow(
      /Invalid SMOKE_TARGET_URL/u,
    )
    expect(() => parseSmokeConfig({ ...baseValidEnv, SMOKE_TARGET_URL: 'ftp://ivybm.com' }, [])).toThrow(
      /Invalid SMOKE_TARGET_URL protocol/u,
    )
    expect(() =>
      parseSmokeConfig({ ...baseValidEnv, SMOKE_TARGET_URL: 'https://user:secret@ivybm.com/path?q=secret' }, []),
    ).toThrow(/must be an origin only/u)
  })

  it('fails fast if production hostname is targeted without SMOKE_CONFIRM_PRODUCTION', () => {
    expect(() =>
      parseSmokeConfig(
        {
          ...baseValidEnv,
          SMOKE_TARGET_URL: 'https://ivybm.com',
        },
        [],
      ),
    ).toThrow(/requires SMOKE_CONFIRM_PRODUCTION="ivybm.com"/u)

    expect(() =>
      parseSmokeConfig(
        {
          ...baseValidEnv,
          SMOKE_CONFIRM_PRODUCTION: 'wrong-confirmation',
          SMOKE_TARGET_URL: 'https://www.ivybm.com',
        },
        [],
      ),
    ).toThrow(/requires SMOKE_CONFIRM_PRODUCTION="ivybm.com"/u)
  })

  it('allows production hostname when SMOKE_CONFIRM_PRODUCTION is exactly "ivybm.com"', () => {
    const config = parseSmokeConfig(
      {
        ...baseValidEnv,
        SMOKE_CONFIRM_PRODUCTION: 'ivybm.com',
        SMOKE_TARGET_URL: 'https://ivybm.com/',
      },
      [],
    )
    expect(config.targetUrl).toBe('https://ivybm.com')
  })

  it('fails fast if Portal credentials are missing', () => {
    expect(() => parseSmokeConfig({ ...baseValidEnv, SMOKE_PORTAL_EMAIL: '' }, [])).toThrow(
      /Missing SMOKE_PORTAL_EMAIL/u,
    )
    expect(() => parseSmokeConfig({ ...baseValidEnv, SMOKE_PORTAL_PASSWORD: '' }, [])).toThrow(
      /Missing SMOKE_PORTAL_PASSWORD/u,
    )
  })

  it('parses valid CLI flags for locales, evidence, scenario, and output-dir', () => {
    const config = parseSmokeConfig(baseValidEnv, [
      '--locales=en,ar',
      '--evidence=compact',
      '--scenario=inquiry',
      '--output-dir=custom/artifacts',
    ])

    expect(config.locales).toEqual(['en', 'ar'])
    expect(config.evidenceMode).toBe('compact')
    expect(config.scenario).toBe('inquiry')
    expect(config.outputDir).toBe('custom/artifacts')
  })

  it('rejects invalid CLI flags', () => {
    expect(() => parseSmokeConfig(baseValidEnv, ['--locales=fr,de'])).toThrow(
      /Invalid --locales argument/u,
    )
    expect(() => parseSmokeConfig(baseValidEnv, ['--evidence=invalid'])).toThrow(
      /Invalid --evidence argument/u,
    )
    expect(() => parseSmokeConfig(baseValidEnv, ['--scenario=invalid'])).toThrow(
      /Invalid --scenario argument/u,
    )
    expect(() => parseSmokeConfig(baseValidEnv, ['--locales=en,fr'])).toThrow(
      /Invalid --locales argument/u,
    )
    expect(() => parseSmokeConfig(baseValidEnv, ['--typo=true'])).toThrow(
      /Unknown smoke argument/u,
    )
  })

  it('rejects Feishu URLs containing embedded credentials', () => {
    expect(() =>
      parseSmokeConfig(
        {
          ...baseValidEnv,
          SMOKE_FEISHU_TABLE_URL: 'https://user:secret@my.feishu.cn/base/test',
        },
        [],
      ),
    ).toThrow(/Credentials/u)
  })

  it('respects headless and custom timeout env overrides', () => {
    const config = parseSmokeConfig(
      {
        ...baseValidEnv,
        SMOKE_HEADLESS: 'false',
        SMOKE_TIMEOUT_MS: '60000',
      },
      [],
    )
    expect(config.headless).toBe(false)
    expect(config.timeoutMs).toBe(60_000)
  })
})
