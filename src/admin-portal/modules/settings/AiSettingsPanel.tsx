'use client'

import { useMemo, useState, type FormEvent } from 'react'

import {
  IconDeviceFloppy,
  IconPencil,
  IconPlus,
  IconRobot,
  IconTrash,
  IconX,
} from '@tabler/icons-react'

import { usePortalCommandKey } from '@/admin-portal/core/commands/usePortalCommandKey'
import { getPortalMessages } from '@/admin-portal/core/i18n/getPortalMessages'
import { usePortalPreferences } from '@/admin-portal/core/navigation/PortalPreferences'
import { Button, StatusBadge, Surface } from '@/admin-portal/core/ui'
import type { OpenAICompatibleTextGenerationContract } from '@/modules/ai/providers/openaiCompatible'
import { AI_USAGE_KEYS } from '@/modules/ai/registry'

import type {
  PortalAiCapability,
  PortalAiModelProfileSummary,
  PortalAiProviderSummary,
  PortalAiSettingsSummary,
  PortalAiUsageRouteSummary,
} from './getPortalAiSettings'

type AiResource = 'profiles' | 'providers' | 'routes'
type Feedback = { message: string; tone: 'error' | 'success' } | null

const toOptionalNumber = (value: string): number | null => {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const resourcePath = (resource: AiResource, id?: number) =>
  `/api/portal/settings/ai/${resource}${id ? `/${id}` : ''}`

export function AiSettingsPanel({ initialSummary }: { initialSummary: PortalAiSettingsSummary }) {
  const { locale } = usePortalPreferences()
  const messages = getPortalMessages(locale).settings.ai
  const command = usePortalCommandKey('portal-ai-settings')
  const [activeResource, setActiveResource] = useState<AiResource>('providers')
  const [busy, setBusy] = useState(false)
  const [editingID, setEditingID] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [summary, setSummary] = useState(initialSummary)

  const refresh = async () => {
    const response = await fetch('/api/portal/settings/ai', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    const body = (await response.json()) as PortalAiSettingsSummary & {
      error?: { message?: string }
    }
    if (!response.ok) throw new Error(body.error?.message || messages.error)
    setSummary(body)
  }

  const mutate = async ({
    body,
    id,
    method,
    resource,
  }: {
    body?: Record<string, unknown>
    id?: number
    method: 'DELETE' | 'PATCH' | 'POST'
    resource: AiResource
  }) => {
    const fingerprint = JSON.stringify({ body: body ?? null, id: id ?? null, method, resource })
    const idempotencyKey = command.key(fingerprint)
    setBusy(true)
    setFeedback(null)
    try {
      const response = await fetch(resourcePath(resource, id), {
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          'Idempotency-Key': idempotencyKey,
        },
        method,
      })
      const result = (await response.json()) as { error?: { message?: string } }
      command.receivedResponse(idempotencyKey)
      if (!response.ok) throw new Error(result.error?.message || messages.error)
      await refresh()
      setEditingID(null)
      setFeedback({ message: messages.saved, tone: 'success' })
    } catch (error) {
      setFeedback({
        message: error instanceof Error && error.message ? error.message : messages.error,
        tone: 'error',
      })
      throw error
    } finally {
      setBusy(false)
    }
  }

  const remove = async (resource: AiResource, id: number, updatedAt: string) => {
    if (!window.confirm(messages.deleteConfirm)) return
    await mutate({ body: { updatedAt }, id, method: 'DELETE', resource }).catch(() => undefined)
  }

  const selectResource = (resource: AiResource) => {
    setActiveResource(resource)
    setEditingID(null)
    setFeedback(null)
  }

  const readinessLabels = {
    'content-studio': messages.contentStudio,
    'customer-chat': messages.customerChat,
    'knowledge-index': messages.knowledgeIndex,
  } as const

  return (
    <Surface as="section" className="portal-settings__section portal-settings__section--wide portal-ai-settings">
      <header className="portal-ai-settings__header">
        <span aria-hidden="true" className="portal-settings__section-icon">
          <IconRobot size={20} stroke={1.8} />
        </span>
        <div>
          <h3>{messages.title}</h3>
          <p>{messages.readiness}</p>
        </div>
        <StatusBadge
          label={summary.encryptionKeyConfigured ? messages.enabled : messages.actionRequired}
          tone={summary.encryptionKeyConfigured ? 'success' : 'warning'}
        />
      </header>

      {!summary.encryptionKeyConfigured ? (
        <p className="portal-ai-settings__warning" role="status">
          {messages.encryptionKeyMissing}
        </p>
      ) : null}

      <div className="portal-ai-settings__readiness">
        {summary.readiness.map((item) => {
          const pending = item.status === 'configured-pending-verification'
          return <article key={item.key}>
            <div>
              <strong>{readinessLabels[item.key]}</strong>
              <small>{item.reason ? messages.readinessReason[item.reason] : pending ? messages.configuredPendingVerification : messages.enabled}</small>
            </div>
            <StatusBadge label={item.status === 'ready' ? messages.enabled : pending ? messages.configuredPendingVerification : messages.actionRequired} tone={item.status === 'ready' ? 'success' : 'warning'} />
          </article>
        })}
      </div>

      <div aria-label={messages.title} className="portal-segmented portal-ai-settings__tabs">
        {([
          ['providers', messages.providers],
          ['profiles', messages.models],
          ['routes', messages.routes],
        ] as const).map(([resource, label]) => (
          <Button
            aria-pressed={activeResource === resource}
            key={resource}
            onClick={() => selectResource(resource)}
            size="compact"
            variant={activeResource === resource ? 'primary' : 'ghost'}
          >
            {label}
          </Button>
        ))}
      </div>

      {feedback ? (
        <p className={`portal-ai-settings__feedback is-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
          {feedback.message}
        </p>
      ) : null}

      {activeResource === 'providers' ? (
        <ProviderWorkspace
          busy={busy}
          editingID={editingID}
          messages={messages}
          onCancel={() => setEditingID(null)}
          onDelete={(id) => {
            const item = summary.providers.find((provider) => provider.id === id)
            if (item) void remove('providers', id, item.updatedAt)
          }}
          onEdit={setEditingID}
          onSave={(body, id) =>
            mutate({ body, id: id ?? undefined, method: id ? 'PATCH' : 'POST', resource: 'providers' })
          }
          providers={summary.providers}
        />
      ) : null}
      {activeResource === 'profiles' ? (
        <ProfileWorkspace
          busy={busy}
          editingID={editingID}
          messages={messages}
          onCancel={() => setEditingID(null)}
          onDelete={(id) => {
            const item = summary.profiles.find((profile) => profile.id === id)
            if (item) void remove('profiles', id, item.updatedAt)
          }}
          onEdit={setEditingID}
          onSave={(body, id) =>
            mutate({ body, id: id ?? undefined, method: id ? 'PATCH' : 'POST', resource: 'profiles' })
          }
          profiles={summary.profiles}
          providers={summary.providers}
        />
      ) : null}
      {activeResource === 'routes' ? (
        <RouteWorkspace
          busy={busy}
          editingID={editingID}
          messages={messages}
          onCancel={() => setEditingID(null)}
          onDelete={(id) => {
            const item = summary.routes.find((route) => route.id === id)
            if (item) void remove('routes', id, item.updatedAt)
          }}
          onEdit={setEditingID}
          onSave={(body, id) =>
            mutate({ body, id: id ?? undefined, method: id ? 'PATCH' : 'POST', resource: 'routes' })
          }
          profiles={summary.profiles}
          routes={summary.routes}
        />
      ) : null}
    </Surface>
  )
}

type AiMessages = ReturnType<typeof getPortalMessages>['settings']['ai']
type SaveHandler = (body: Record<string, unknown>, id: number | null) => Promise<void>

const RowActions = ({
  busy,
  id,
  messages,
  onDelete,
  onEdit,
}: {
  busy: boolean
  id: number
  messages: AiMessages
  onDelete: (id: number) => void
  onEdit: (id: number) => void
}) => (
  <div className="portal-ai-settings__row-actions">
    <Button aria-label={messages.edit} disabled={busy} onClick={() => onEdit(id)} size="icon" variant="ghost" title={messages.edit}>
      <IconPencil size={16} stroke={1.8} />
    </Button>
    <Button aria-label={messages.delete} disabled={busy} onClick={() => onDelete(id)} size="icon" variant="ghost" title={messages.delete}>
      <IconTrash size={16} stroke={1.8} />
    </Button>
  </div>
)

function ProviderWorkspace({
  busy,
  editingID,
  messages,
  onCancel,
  onDelete,
  onEdit,
  onSave,
  providers,
}: {
  busy: boolean
  editingID: number | null
  messages: AiMessages
  onCancel: () => void
  onDelete: (id: number) => void
  onEdit: (id: number) => void
  onSave: SaveHandler
  providers: PortalAiProviderSummary[]
}) {
  const existing = providers.find((item) => item.id === editingID) ?? null
  const [creating, setCreating] = useState(false)
  const formKey = existing ? `provider-${existing.id}` : creating ? 'provider-new' : 'provider-none'
  const showForm = Boolean(existing || creating)
  return (
    <div className="portal-ai-settings__workspace">
      <div className="portal-ai-settings__list">
        <div className="portal-ai-settings__list-heading">
          <h4>{messages.providers}</h4>
          <Button onClick={() => { onCancel(); setCreating(true) }} size="compact" variant="secondary">
            <IconPlus size={15} stroke={1.8} /> {messages.newProvider}
          </Button>
        </div>
        {providers.length ? providers.map((provider) => (
          <article key={provider.id}>
            <div>
              <strong>{provider.name}</strong>
              <span>{provider.baseURL}</span>
              <small>{provider.apiKeyConfigured ? messages.apiKeyConfigured : messages.actionRequired}</small>
            </div>
            <StatusBadge label={provider.enabled ? messages.enabled : messages.disabled} tone={provider.enabled ? 'success' : 'neutral'} />
            <RowActions busy={busy} id={provider.id} messages={messages} onDelete={onDelete} onEdit={(id) => { setCreating(false); onEdit(id) }} />
          </article>
        )) : <p className="portal-ai-settings__empty">{messages.noProviders}</p>}
      </div>
      {showForm ? (
        <ProviderForm
          busy={busy}
          key={formKey}
          messages={messages}
          onCancel={() => { setCreating(false); onCancel() }}
          onSave={async (body, id) => { await onSave(body, id); setCreating(false) }}
          provider={existing}
        />
      ) : null}
    </div>
  )
}

function ProviderForm({ busy, messages, onCancel, onSave, provider }: { busy: boolean; messages: AiMessages; onCancel: () => void; onSave: SaveHandler; provider: PortalAiProviderSummary | null }) {
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState(provider?.baseURL ?? '')
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [name, setName] = useState(provider?.name ?? '')
  const [textGenerationContract, setTextGenerationContract] =
    useState<OpenAICompatibleTextGenerationContract>(
      provider?.textGenerationContract ?? 'responses',
    )
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await onSave(
      { apiKey, baseURL, enabled, name, textGenerationContract, updatedAt: provider?.updatedAt },
      provider?.id ?? null,
    ).catch(() => undefined)
  }
  return (
    <form className="portal-ai-settings__form" onSubmit={submit}>
      <header><h4>{provider ? messages.edit : messages.newProvider}</h4></header>
      <label><span>{messages.providerName}</span><input disabled={busy} maxLength={100} onChange={(event) => setName(event.target.value)} required value={name} /></label>
      <label><span>{messages.baseURL}</span><input disabled={busy} maxLength={600} onChange={(event) => setBaseURL(event.target.value)} placeholder="https://api.openai.com/v1" required type="url" value={baseURL} /></label>
      <label><span>{messages.textGenerationContract}</span><select disabled={busy} onChange={(event) => setTextGenerationContract(event.target.value as OpenAICompatibleTextGenerationContract)} value={textGenerationContract}><option value="responses">{messages.textGenerationContracts.responses}</option><option value="chat-completions">{messages.textGenerationContracts['chat-completions']}</option></select><small>{messages.textGenerationContractDescription}</small></label>
      <label><span>{messages.apiKey}</span><input autoComplete="new-password" disabled={busy} maxLength={4096} onChange={(event) => setApiKey(event.target.value)} required={!provider?.apiKeyConfigured} type="password" value={apiKey} /><small>{messages.apiKeyDescription}</small></label>
      <label className="portal-ai-settings__check"><input checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" /><span>{messages.enabled}</span></label>
      <FormActions busy={busy} messages={messages} onCancel={onCancel} />
    </form>
  )
}

function ProfileWorkspace({ busy, editingID, messages, onCancel, onDelete, onEdit, onSave, profiles, providers }: { busy: boolean; editingID: number | null; messages: AiMessages; onCancel: () => void; onDelete: (id: number) => void; onEdit: (id: number) => void; onSave: SaveHandler; profiles: PortalAiModelProfileSummary[]; providers: PortalAiProviderSummary[] }) {
  const existing = profiles.find((item) => item.id === editingID) ?? null
  const [creating, setCreating] = useState(false)
  const showForm = Boolean(existing || creating)
  return (
    <div className="portal-ai-settings__workspace">
      <div className="portal-ai-settings__list">
        <div className="portal-ai-settings__list-heading"><h4>{messages.models}</h4><Button disabled={!providers.length} onClick={() => { onCancel(); setCreating(true) }} size="compact" variant="secondary"><IconPlus size={15} stroke={1.8} /> {messages.newModel}</Button></div>
        {profiles.length ? profiles.map((profile) => (
          <article key={profile.id}><div><strong>{profile.name}</strong><span>{profile.model}</span><small>{profile.providerName ?? messages.actionRequired} · {messages.capabilities[profile.capability]}</small></div><StatusBadge label={profile.enabled ? messages.enabled : messages.disabled} tone={profile.enabled ? 'success' : 'neutral'} /><RowActions busy={busy} id={profile.id} messages={messages} onDelete={onDelete} onEdit={(id) => { setCreating(false); onEdit(id) }} /></article>
        )) : <p className="portal-ai-settings__empty">{messages.noModels}</p>}
      </div>
      {showForm ? <ProfileForm busy={busy} key={existing ? `profile-${existing.id}` : 'profile-new'} messages={messages} onCancel={() => { setCreating(false); onCancel() }} onSave={async (body, id) => { await onSave(body, id); setCreating(false) }} profile={existing} providers={providers} /> : null}
    </div>
  )
}

function ProfileForm({ busy, messages, onCancel, onSave, profile, providers }: { busy: boolean; messages: AiMessages; onCancel: () => void; onSave: SaveHandler; profile: PortalAiModelProfileSummary | null; providers: PortalAiProviderSummary[] }) {
  const [capability, setCapability] = useState<PortalAiCapability>(profile?.capability ?? 'text')
  const [dimensions, setDimensions] = useState(String(profile?.parameters.dimensions ?? 1536))
  const [enabled, setEnabled] = useState(profile?.enabled ?? true)
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(profile?.parameters.maxOutputTokens ?? 2048))
  const [model, setModel] = useState(profile?.model ?? '')
  const [name, setName] = useState(profile?.name ?? '')
  const [providerID, setProviderID] = useState(profile?.providerID ?? providers[0]?.id ?? 0)
  const [reasoningEffort, setReasoningEffort] = useState(profile?.parameters.reasoningEffort ?? 'medium')
  const [reasoningEnabled, setReasoningEnabled] = useState(profile?.parameters.reasoningEnabled ?? false)
  const [temperature, setTemperature] = useState(String(profile?.parameters.temperature ?? ''))
  const [timeoutMs, setTimeoutMs] = useState(
    String(profile?.parameters.timeoutMs ?? (capability === 'image' ? 120000 : 30000)),
  )
  const [topP, setTopP] = useState(String(profile?.parameters.topP ?? ''))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await onSave({ capability, enabled, model, name, parameters: { dimensions: capability === 'embedding' ? Number(dimensions) : null, maxOutputTokens: capability === 'text' ? toOptionalNumber(maxOutputTokens) : null, reasoningEffort, reasoningEnabled: capability === 'text' && reasoningEnabled, temperature: capability === 'text' ? toOptionalNumber(temperature) : null, timeoutMs: Number(timeoutMs), topP: capability === 'text' ? toOptionalNumber(topP) : null }, providerID, updatedAt: profile?.updatedAt }, profile?.id ?? null).catch(() => undefined)
  }
  return (
    <form className="portal-ai-settings__form" onSubmit={submit}>
      <header><h4>{profile ? messages.edit : messages.newModel}</h4></header>
      <div className="portal-ai-settings__form-grid">
        <label><span>{messages.modelName}</span><input disabled={busy} maxLength={100} onChange={(event) => setName(event.target.value)} required value={name} /></label>
        <label><span>{messages.provider}</span><select disabled={busy} onChange={(event) => setProviderID(Number(event.target.value))} required value={providerID}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        <label><span>{messages.capability}</span><select disabled={busy} onChange={(event) => { const nextCapability = event.target.value as PortalAiCapability; setCapability(nextCapability); if (!profile) setTimeoutMs(String(nextCapability === 'image' ? 120000 : 30000)) }} value={capability}><option value="text">{messages.capabilities.text}</option><option value="embedding">{messages.capabilities.embedding}</option><option value="image">{messages.capabilities.image}</option></select></label>
        <label><span>{messages.model}</span><input disabled={busy} maxLength={200} onChange={(event) => setModel(event.target.value)} required value={model} /></label>
        <label><span>{messages.timeout}</span><input disabled={busy} max={120000} min={1000} onChange={(event) => setTimeoutMs(event.target.value)} required type="number" value={timeoutMs} /></label>
        {capability === 'embedding' ? <label><span>{messages.dimensions}</span><input disabled={busy} max={16384} min={1} onChange={(event) => setDimensions(event.target.value)} required type="number" value={dimensions} /></label> : null}
        {capability === 'text' ? <><label><span>{messages.maxOutputTokens}</span><input disabled={busy} max={128000} min={1} onChange={(event) => setMaxOutputTokens(event.target.value)} type="number" value={maxOutputTokens} /></label><label><span>{messages.temperature}</span><input disabled={busy} max={2} min={0} onChange={(event) => setTemperature(event.target.value)} step="0.1" type="number" value={temperature} /></label><label><span>{messages.topP}</span><input disabled={busy} max={1} min={0} onChange={(event) => setTopP(event.target.value)} step="0.1" type="number" value={topP} /></label><label><span>{messages.reasoningEffort}</span><select disabled={busy || !reasoningEnabled} onChange={(event) => setReasoningEffort(event.target.value)} value={reasoningEffort}>{['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></> : null}
      </div>
      {capability === 'text' ? <label className="portal-ai-settings__check"><input checked={reasoningEnabled} disabled={busy} onChange={(event) => setReasoningEnabled(event.target.checked)} type="checkbox" /><span>{messages.reasoningEnabled}</span></label> : null}
      <label className="portal-ai-settings__check"><input checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" /><span>{messages.enabled}</span></label>
      <FormActions busy={busy} messages={messages} onCancel={onCancel} />
    </form>
  )
}

function RouteWorkspace({ busy, editingID, messages, onCancel, onDelete, onEdit, onSave, profiles, routes }: { busy: boolean; editingID: number | null; messages: AiMessages; onCancel: () => void; onDelete: (id: number) => void; onEdit: (id: number) => void; onSave: SaveHandler; profiles: PortalAiModelProfileSummary[]; routes: PortalAiUsageRouteSummary[] }) {
  const existing = routes.find((item) => item.id === editingID) ?? null
  const [creating, setCreating] = useState(false)
  const showForm = Boolean(existing || creating)
  return (
    <div className="portal-ai-settings__workspace">
      <div className="portal-ai-settings__list">
        <div className="portal-ai-settings__list-heading"><h4>{messages.routes}</h4><Button disabled={!profiles.length} onClick={() => { onCancel(); setCreating(true) }} size="compact" variant="secondary"><IconPlus size={15} stroke={1.8} /> {messages.newRoute}</Button></div>
        {routes.length ? routes.map((route) => <article key={route.id}><div><strong>{route.usageKey}</strong><span>{route.profileName ?? messages.actionRequired}</span><small>{messages.capabilities[route.operation]}</small></div><StatusBadge label={route.enabled ? messages.enabled : messages.disabled} tone={route.enabled ? 'success' : 'neutral'} /><RowActions busy={busy} id={route.id} messages={messages} onDelete={onDelete} onEdit={(id) => { setCreating(false); onEdit(id) }} /></article>) : <p className="portal-ai-settings__empty">{messages.noRoutes}</p>}
      </div>
      {showForm ? <RouteForm busy={busy} key={existing ? `route-${existing.id}` : 'route-new'} messages={messages} onCancel={() => { setCreating(false); onCancel() }} onSave={async (body, id) => { await onSave(body, id); setCreating(false) }} profiles={profiles} route={existing} /> : null}
    </div>
  )
}

function RouteForm({ busy, messages, onCancel, onSave, profiles, route }: { busy: boolean; messages: AiMessages; onCancel: () => void; onSave: SaveHandler; profiles: PortalAiModelProfileSummary[]; route: PortalAiUsageRouteSummary | null }) {
  const [enabled, setEnabled] = useState(route?.enabled ?? true)
  const [usageKey, setUsageKey] = useState(route?.usageKey ?? AI_USAGE_KEYS.chatReply)
  const operation: PortalAiCapability = usageKey === AI_USAGE_KEYS.knowledgeEmbedding ? 'embedding' : usageKey === AI_USAGE_KEYS.contentImageGeneration ? 'image' : 'text'
  const compatible = useMemo(() => profiles.filter((profile) => profile.capability === operation), [operation, profiles])
  const [profileID, setProfileID] = useState(route?.profileID ?? compatible[0]?.id ?? 0)
  const normalizedProfileID = compatible.some((profile) => profile.id === profileID) ? profileID : compatible[0]?.id ?? 0
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSave({ enabled, operation, profileID: normalizedProfileID, updatedAt: route?.updatedAt, usageKey }, route?.id ?? null).catch(() => undefined) }
  return (
    <form className="portal-ai-settings__form" onSubmit={submit}>
      <header><h4>{route ? messages.edit : messages.newRoute}</h4></header>
      <label><span>{messages.usageKey}</span><select disabled={busy} onChange={(event) => setUsageKey(event.target.value)} value={usageKey}><option value={AI_USAGE_KEYS.chatReply}>{messages.usageLabels[AI_USAGE_KEYS.chatReply]} · {AI_USAGE_KEYS.chatReply}</option><option value={AI_USAGE_KEYS.knowledgeEmbedding}>{messages.usageLabels[AI_USAGE_KEYS.knowledgeEmbedding]} · {AI_USAGE_KEYS.knowledgeEmbedding}</option><option value={AI_USAGE_KEYS.knowledgeTranslation}>{messages.usageLabels[AI_USAGE_KEYS.knowledgeTranslation]} · {AI_USAGE_KEYS.knowledgeTranslation}</option><option value={AI_USAGE_KEYS.contentImageGeneration}>{messages.usageLabels[AI_USAGE_KEYS.contentImageGeneration]} · {AI_USAGE_KEYS.contentImageGeneration}</option></select></label>
      <label><span>{messages.profile}</span><select disabled={busy || !compatible.length} onChange={(event) => setProfileID(Number(event.target.value))} required value={normalizedProfileID}>{compatible.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}</select></label>
      <label className="portal-ai-settings__check"><input checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" /><span>{messages.enabled}</span></label>
      <FormActions busy={busy || !compatible.length} messages={messages} onCancel={onCancel} />
    </form>
  )
}

const FormActions = ({ busy, messages, onCancel }: { busy: boolean; messages: AiMessages; onCancel: () => void }) => (
  <div className="portal-ai-settings__form-actions">
    <Button disabled={busy} type="submit"><IconDeviceFloppy size={16} stroke={1.8} /> {messages.save}</Button>
    <Button disabled={busy} onClick={onCancel} variant="ghost"><IconX size={16} stroke={1.8} /> {messages.cancel}</Button>
  </div>
)
