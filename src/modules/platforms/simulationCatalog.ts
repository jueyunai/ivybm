export type PlatformSimulationId =
  | 'facebook-publishing'
  | 'instagram-publishing'
  | 'linkedin-publishing'
  | 'meta-conversation-outbound'
  | 'meta-inbound-normalization'
  | 'no-account-degradation'
  | 'tiktok-signature'
  | 'unknown-outcome-recovery'

export type PlatformSimulationFamily = 'facebook' | 'instagram' | 'linkedin' | 'meta' | 'tiktok'

export type LocalizedText = {
  en: string
  zh: string
}

export type PlatformSimulationCatalogItem = {
  description: LocalizedText
  family: PlatformSimulationFamily
  id: PlatformSimulationId
  title: LocalizedText
}

export const PLATFORM_SIMULATION_CATALOG: readonly PlatformSimulationCatalogItem[] = [
  {
    description: {
      en: 'Normalize a signed-provider-shaped Messenger event without retaining URL credentials.',
      zh: '归一化 Messenger 模拟事件，并确认附件 URL 不保留签名参数。',
    },
    family: 'meta',
    id: 'meta-inbound-normalization',
    title: { en: 'Meta inbound normalization', zh: 'Meta 入站归一化' },
  },
  {
    description: {
      en: 'Build and parse a credential-free Messenger reply request.',
      zh: '构造并解析不携带凭据的 Messenger 回复请求。',
    },
    family: 'meta',
    id: 'meta-conversation-outbound',
    title: { en: 'Meta reply request', zh: 'Meta 回复请求' },
  },
  {
    description: {
      en: 'Build a Facebook Page photo request and parse a provider-shaped acceptance.',
      zh: '构造 Facebook 主页图片发布请求并解析模拟受理结果。',
    },
    family: 'facebook',
    id: 'facebook-publishing',
    title: { en: 'Facebook photo publishing', zh: 'Facebook 图片发布' },
  },
  {
    description: {
      en: 'Exercise the Instagram media, status, and publish request sequence.',
      zh: '演练 Instagram 媒体创建、状态查询和发布请求序列。',
    },
    family: 'instagram',
    id: 'instagram-publishing',
    title: { en: 'Instagram publishing sequence', zh: 'Instagram 发布序列' },
  },
  {
    description: {
      en: 'Exercise LinkedIn image initialization, PUT upload, post, and status parsing.',
      zh: '演练 LinkedIn 图片初始化、PUT 上传、发帖和状态解析。',
    },
    family: 'linkedin',
    id: 'linkedin-publishing',
    title: { en: 'LinkedIn image publishing', zh: 'LinkedIn 图片发布' },
  },
  {
    description: {
      en: 'Verify the official TikTok webhook signature seam without inventing a DM payload.',
      zh: '验证 TikTok 官方 Webhook 签名，不虚构私信事件结构。',
    },
    family: 'tiktok',
    id: 'tiktok-signature',
    title: { en: 'TikTok signature verification', zh: 'TikTok 签名验证' },
  },
  {
    description: {
      en: 'Confirm every default publishing path fails closed while no account is connected.',
      zh: '确认未连接账号时所有默认发布路径都安全降级。',
    },
    family: 'meta',
    id: 'no-account-degradation',
    title: { en: 'No-account degradation', zh: '无账号降级' },
  },
  {
    description: {
      en: 'Lose an accepted provider result and stop at manual reconciliation without resending.',
      zh: '模拟平台已受理但结果丢失，并在不重发的情况下进入人工核对。',
    },
    family: 'meta',
    id: 'unknown-outcome-recovery',
    title: { en: 'Unknown outcome recovery', zh: '未知结果恢复' },
  },
] as const

export const PLATFORM_SIMULATION_IDS = PLATFORM_SIMULATION_CATALOG.map(({ id }) => id)

export const isPlatformSimulationId = (value: unknown): value is PlatformSimulationId =>
  typeof value === 'string' && PLATFORM_SIMULATION_IDS.some((id) => id === value)

export type PlatformSimulationStep = {
  detail?: LocalizedText
  label: LocalizedText
  status: 'blocked' | 'passed' | 'warning'
}

export type PlatformSimulationResult = {
  id: PlatformSimulationId
  request?: {
    method: 'GET' | 'POST' | 'PUT'
    path: string
  }
  status: 'blocked' | 'passed'
  steps: PlatformSimulationStep[]
  summary: LocalizedText
}
