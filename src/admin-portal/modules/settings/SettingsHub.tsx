'use client'

import { IconAccessible, IconBuildingStore, IconUserCircle } from '@tabler/icons-react'

import type { PortalUser } from '@/admin-portal/core/auth/types'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import type { ResolvedPortalModule } from '@/admin-portal/core/modules/types'
import { Button, PortalState, StatusBadge, Surface } from '@/admin-portal/core/ui'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'

import type { PortalSettingsSummary } from './getPortalSettingsSummary'
import type { PortalAiSettingsSummary } from './getPortalAiSettings'
import { AiSettingsPanel } from './AiSettingsPanel'

export interface SettingsHubProps {
  aiReadError?: boolean
  aiSettings: PortalAiSettingsSummary
  modules: readonly ResolvedPortalModule[]
  pageState?: 'available' | 'module-disabled' | 'portal-disabled'
  readError?: boolean
  summary: PortalSettingsSummary | null
  user: PortalUser
}

const roleLabel = (role: PortalUser['role'], locale: 'en' | 'zh'): string => {
  const messages = getPortalMessages(locale)
  return {
    admin: messages.shell.roleAdmin,
    operator: messages.shell.roleOperator,
    sales: messages.shell.roleSales,
  }[role]
}

const statusTone = (
  module: ResolvedPortalModule,
): 'danger' | 'info' | 'neutral' | 'success' | 'warning' => {
  if (module.featureState.enabled) return 'success'
  if (module.featureState.reason === 'blocked') return 'danger'
  if (module.featureState.reason === 'portal-disabled') return 'danger'
  if (module.featureState.reason === 'dependency-gated') return 'warning'
  return 'neutral'
}

export function SettingsHub({ aiReadError = false, aiSettings, modules, pageState = 'available', readError = false, summary, user }: SettingsHubProps) {
  const { locale, reducedMotion, setLocale, setReducedMotion, setTheme, theme } =
    usePortalPreferences()
  const messages = getPortalMessages(locale)

  if (pageState !== 'available') {
    const state = messages.states[pageState]
    return (
      <main className="portal-page portal-settings">
        <PortalState description={state} title={state} type="blocked" />
      </main>
    )
  }

  return (
    <main className="portal-page portal-settings">
      <header className="portal-page__intro">
        <div>
          <h2>{messages.settings.title}</h2>
          <p>{messages.settings.description}</p>
        </div>
      </header>

      <div className="portal-settings__grid">
        <Surface as="section" className="portal-settings__section" id="account">
          <div className="portal-settings__section-heading">
            <span aria-hidden="true" className="portal-settings__section-icon">
              <IconUserCircle size={20} stroke={1.8} />
            </span>
            <div>
              <h3>{messages.settings.accountTitle}</h3>
              <p>{messages.settings.accountDescription}</p>
            </div>
          </div>
          <dl className="portal-settings__account">
            <div>
              <dt>{messages.settings.email}</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>{messages.settings.role}</dt>
              <dd>{roleLabel(user.role, locale)}</dd>
            </div>
          </dl>
        </Surface>

        <Surface as="section" className="portal-settings__section">
          <div className="portal-settings__section-heading">
            <span aria-hidden="true" className="portal-settings__section-icon">
              <IconAccessible size={20} stroke={1.8} />
            </span>
            <div>
              <h3>{messages.settings.preferencesTitle}</h3>
              <p>{messages.settings.preferencesDescription}</p>
            </div>
          </div>

          <div className="portal-settings__field">
            <span>{messages.settings.languageLabel}</span>
            <div aria-label={messages.settings.languageLabel} className="portal-segmented">
              <Button
                aria-pressed={locale === 'zh'}
                onClick={() => setLocale('zh')}
                size="compact"
                variant={locale === 'zh' ? 'primary' : 'ghost'}
              >
                {messages.settings.chinese}
              </Button>
              <Button
                aria-pressed={locale === 'en'}
                onClick={() => setLocale('en')}
                size="compact"
                variant={locale === 'en' ? 'primary' : 'ghost'}
              >
                {messages.settings.english}
              </Button>
            </div>
          </div>

          <div className="portal-settings__field">
            <span>{messages.settings.themeLabel}</span>
            <div aria-label={messages.settings.themeLabel} className="portal-segmented">
              {([
                ['light', messages.settings.lightTheme],
                ['dark', messages.settings.darkTheme],
                ['system', messages.settings.systemTheme],
              ] as const).map(([value, label]) => (
                <Button
                  aria-pressed={theme === value}
                  key={value}
                  onClick={() => setTheme(value)}
                  size="compact"
                  variant={theme === value ? 'primary' : 'ghost'}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <label className="portal-settings__toggle">
            <input
              aria-label={messages.settings.reduceMotion}
              checked={reducedMotion}
              onChange={(event) => setReducedMotion(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>{messages.settings.reduceMotion}</strong>
              <small>{messages.settings.reduceMotionDescription}</small>
            </span>
          </label>
        </Surface>

        {user.role === 'admin' && aiReadError ? (
          <Surface
            as="section"
            className="portal-settings__section portal-settings__section--wide portal-ai-settings"
          >
            <header className="portal-ai-settings__header">
              <div>
                <h3>{messages.settings.ai.title}</h3>
                <p>{messages.settings.ai.readiness}</p>
              </div>
            </header>
            <PortalState
              description={messages.states.error}
              title={messages.states.error}
              type="error"
            />
          </Surface>
        ) : user.role === 'admin' && aiSettings.access === 'admin' ? (
          <AiSettingsPanel initialSummary={aiSettings} />
        ) : null}

        <Surface as="section" className="portal-settings__section portal-settings__section--wide">
          <div className="portal-settings__section-heading">
            <span aria-hidden="true" className="portal-settings__section-icon">
              <IconBuildingStore size={20} stroke={1.8} />
            </span>
            <div>
              <h3>{messages.settings.siteSummaryTitle}</h3>
              <p>{messages.settings.siteSummaryDescription}</p>
            </div>
            <StatusBadge label={messages.settings.readOnly} tone="neutral" />
          </div>
          {readError || !summary ? (
            <PortalState
              description={messages.states.error}
              title={messages.states.error}
              type="error"
            />
          ) : (
            <dl className="portal-settings__summary">
              <div>
                <dt>{messages.settings.siteName}</dt>
                <dd>{summary.siteName}</dd>
              </div>
              <div>
                <dt>{messages.settings.siteDescription}</dt>
                <dd>{summary.siteDescription ?? messages.settings.noSiteDescription}</dd>
              </div>
              {summary.canUpdate ? (
                <div className="portal-settings__permission">
                  <dt>{messages.settings.permission}</dt>
                  <dd>{messages.settings.canUpdateSite}</dd>
                </div>
              ) : null}
            </dl>
          )}
        </Surface>

        <Surface as="section" className="portal-settings__section portal-settings__section--wide">
          <div className="portal-settings__section-heading">
            <div>
              <h3>{messages.settings.moduleStatusTitle}</h3>
              <p>{messages.settings.moduleStatusDescription}</p>
            </div>
          </div>
          <div className="portal-settings__modules">
            {modules.map((portalModule) => (
              <article className="portal-settings__module" key={portalModule.id}>
                <div>
                  <strong>{messages.modules[portalModule.labelKey]}</strong>
                  <span>
                    {messages.settings.moduleOwner}: {portalModule.owner}
                  </span>
                </div>
                <p>
                  <span>{messages.settings.nextStep}</span>
                  {messages.nextSteps[portalModule.maintenance.nextStepKey]}
                </p>
                <StatusBadge
                  label={messages.states[portalModule.featureState.reason]}
                  tone={statusTone(portalModule)}
                />
              </article>
            ))}
          </div>
        </Surface>
      </div>
    </main>
  )
}
