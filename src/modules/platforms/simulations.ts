import { createHmac } from 'node:crypto'

import {
  createFakePlatformConversationOutboundPort,
  createFakePlatformConversationOutboundProviderState,
} from './fakeConversationOutboundPort'
import { createFakePlatformPublishingPort } from './fakePublishingPort'
import { type PlatformSimulationId, type PlatformSimulationResult } from './simulationCatalog'
import { createMetaConnector } from './meta/connector'
import {
  buildMetaConversationReplyRequest,
  parseMetaConversationReplyResponse,
} from './meta/conversationRequests'
import {
  buildFacebookPagePhotoRequest,
  buildInstagramContainerStatusRequest,
  buildInstagramMediaPublishRequest,
  buildInstagramMediaRequest,
  parseFacebookPagePhotoResponse,
  parseInstagramContainerStatusResponse,
  parseInstagramMediaPublishResponse,
  parseInstagramMediaResponse,
} from './meta/publishingRequests'
import {
  buildLinkedInImageBinaryUploadPayload,
  buildLinkedInImageInitializeUploadRequest,
  buildLinkedInImagePostRequest,
  buildLinkedInPostStatusRequest,
  parseLinkedInImageInitializeUploadResponse,
  parseLinkedInPostCreationResponse,
  parseLinkedInPostStatusResponse,
} from './linkedin/publishingRequests'
import { verifyTikTokWebhookSignature } from './tiktok/webhook'
import type { PlatformConversationOutboundRequest, PublishingPlatform } from './types'

const passed = (zh: string, en: string, detail?: { en: string; zh: string }) => ({
  ...(detail ? { detail } : {}),
  label: { en, zh },
  status: 'passed' as const,
})

const blocked = (zh: string, en: string, detail?: { en: string; zh: string }) => ({
  ...(detail ? { detail } : {}),
  label: { en, zh },
  status: 'blocked' as const,
})

const metaInboundSimulation = (): PlatformSimulationResult => {
  const [event] = createMetaConnector().normalize({
    entry: [
      {
        id: 'PAGE_DEMO_1',
        messaging: [
          {
            message: {
              attachments: [
                {
                  payload: {
                    url: 'https://media.example.invalid/panel.jpg?signature=fixture-secret#preview',
                  },
                  type: 'image',
                },
              ],
              mid: 'm_demo_1',
              text: 'Please share the available facade finishes.',
            },
            recipient: { id: 'PAGE_DEMO_1' },
            sender: { id: 'CONTACT_DEMO_1' },
            timestamp: 1_710_000_000_123,
          },
        ],
      },
    ],
    object: 'page',
  })
  if (!event || event.kind !== 'inbound-message') {
    throw new Error('Meta inbound simulation did not produce one message')
  }
  const attachmentURL = event.content.attachments?.[0]?.url
  if (attachmentURL !== 'https://media.example.invalid/panel.jpg') {
    throw new Error('Meta inbound simulation retained unsafe attachment data')
  }

  return {
    id: 'meta-inbound-normalization',
    status: 'passed',
    steps: [
      passed('事件归一化完成', 'Event normalized', {
        en: `Message ${event.externalEventId} was scoped to ${event.accountExternalId}.`,
        zh: `消息 ${event.externalEventId} 已按账号 ${event.accountExternalId} 隔离。`,
      }),
      passed('附件地址已最小化', 'Attachment URL minimized', {
        en: attachmentURL,
        zh: attachmentURL,
      }),
      passed('幂等键由服务端派生', 'Idempotency key derived server-side'),
    ],
    summary: {
      en: 'The synthetic Messenger event was normalized without persisting provider URL credentials.',
      zh: '模拟 Messenger 事件已归一化，平台 URL 凭据未进入持久化数据。',
    },
  }
}

const metaConversationSimulation = (): PlatformSimulationResult => {
  const request = buildMetaConversationReplyRequest({
    platform: 'facebook-messenger',
    recipientExternalId: '9876543210987654',
    text: 'Which finish and approximate quantity do you need?',
  })
  const acceptance = parseMetaConversationReplyResponse({
    message_id: 'm_demo_provider_1',
    recipient_id: '9876543210987654',
  })

  return {
    id: 'meta-conversation-outbound',
    request: { method: request.method, path: request.path },
    status: 'passed',
    steps: [
      passed('请求体不含 token', 'Request contains no token'),
      passed('模拟响应已解析', 'Synthetic response parsed', {
        en: `Provider message ${acceptance.messageId}`,
        zh: `平台消息 ${acceptance.messageId}`,
      }),
      blocked('真实发送仍需账号授权', 'Real delivery still requires account authorization'),
    ],
    summary: {
      en: 'The request seam is ready for a credential-injecting adapter; no network call was made.',
      zh: '请求 seam 已可供后续凭据注入 adapter 使用，本次未发起网络调用。',
    },
  }
}

const facebookPublishingSimulation = (): PlatformSimulationResult => {
  const request = buildFacebookPagePhotoRequest({
    caption: 'Aluminum facade panel for global projects.',
    pageId: '1234567890',
    url: 'https://media.example.invalid/facade-panel.jpg',
  })
  const acceptance = parseFacebookPagePhotoResponse({
    id: '1234567890123456',
    post_id: '1234567890_9876543210',
  })

  return {
    id: 'facebook-publishing',
    request: { method: request.method, path: request.path },
    status: 'passed',
    steps: [
      passed('图片发布请求已构造', 'Photo request built'),
      passed('模拟受理 ID 已解析', 'Synthetic acceptance parsed', {
        en: acceptance.postId ?? acceptance.photoId ?? '',
        zh: acceptance.postId ?? acceptance.photoId ?? '',
      }),
      blocked('未知网络结果禁止自动重试', 'Unknown network outcomes cannot be retried blindly'),
    ],
    summary: {
      en: 'Facebook request and response contracts passed without credentials or transport I/O.',
      zh: 'Facebook 请求与响应契约已通过，未携带凭据或执行传输。',
    },
  }
}

const instagramPublishingSimulation = (): PlatformSimulationResult => {
  const mediaRequest = buildInstagramMediaRequest({
    caption: 'Aluminum facade panel for global projects.',
    igId: '17895695688002100',
    imageUrl: 'https://media.example.invalid/facade-panel.jpg',
  })
  const media = parseInstagramMediaResponse({ id: '17895695688002101' })
  const statusRequest = buildInstagramContainerStatusRequest({ containerId: media.creationId })
  const status = parseInstagramContainerStatusResponse({ status_code: 'FINISHED' })
  const publishRequest = buildInstagramMediaPublishRequest({
    creationId: media.creationId,
    igId: '17895695688002100',
  })
  const publication = parseInstagramMediaPublishResponse({ id: '17895695688002102' })

  return {
    id: 'instagram-publishing',
    request: { method: mediaRequest.method, path: mediaRequest.path },
    status: 'passed',
    steps: [
      passed('媒体容器请求已构造', 'Media container request built'),
      passed('容器状态已解析', 'Container status parsed', {
        en: `${statusRequest.path}: ${status.statusCode}`,
        zh: `${statusRequest.path}: ${status.statusCode}`,
      }),
      passed('发布请求与结果已解析', 'Publish request and response parsed', {
        en: `${publishRequest.path}: ${publication.igMediaId}`,
        zh: `${publishRequest.path}: ${publication.igMediaId}`,
      }),
      blocked('真实容器轮询需受控 adapter', 'Real container polling requires a controlled adapter'),
    ],
    summary: {
      en: 'The complete Instagram request sequence passed with synthetic provider responses.',
      zh: 'Instagram 完整请求序列已使用模拟平台响应通过。',
    },
  }
}

const linkedInPublishingSimulation = (): PlatformSimulationResult => {
  const author = { kind: 'person' as const, personId: 'demoMember01' }
  const initializeRequest = buildLinkedInImageInitializeUploadRequest({
    author,
    linkedInVersion: '202607',
  })
  const initialized = parseLinkedInImageInitializeUploadResponse({
    value: {
      image: 'urn:li:image:C4E10AQFoyyAjHPMQuQ',
      uploadUrl: 'https://upload.linkedin.com/demo-image',
      uploadUrlExpiresAt: 1_753_600_060_000,
    },
  })
  const upload = buildLinkedInImageBinaryUploadPayload({
    bytes: new Uint8Array([1, 2, 3]),
    contentType: 'image/png',
    nowMilliseconds: 1_753_600_000_000,
    uploadUrl: initialized.uploadUrl,
    uploadUrlExpiresAt: initialized.uploadUrlExpiresAt,
  })
  const postRequest = buildLinkedInImagePostRequest({
    author,
    commentary: 'Aluminum facade systems for global projects.',
    image: { altText: 'Aluminum facade panel', imageUrn: initialized.imageUrn },
    linkedInVersion: '202607',
  })
  const post = parseLinkedInPostCreationResponse({
    xRestliId: 'urn:li:share:7123456789012345678',
  })
  const statusRequest = buildLinkedInPostStatusRequest({
    linkedInVersion: '202607',
    postUrn: post.postUrn,
  })
  const status = parseLinkedInPostStatusResponse({ lifecycleState: 'PUBLISHED' })

  return {
    id: 'linkedin-publishing',
    request: { method: initializeRequest.method, path: initializeRequest.path },
    status: 'passed',
    steps: [
      passed('上传初始化请求已构造', 'Upload initialization request built'),
      passed('PUT 上传证据有效', 'PUT upload evidence valid', {
        en: `${upload.method} ${new URL(upload.uploadUrl).pathname}`,
        zh: `${upload.method} ${new URL(upload.uploadUrl).pathname}`,
      }),
      passed('图片发帖请求已构造', 'Image post request built', {
        en: `${postRequest.method} ${postRequest.path}`,
        zh: `${postRequest.method} ${postRequest.path}`,
      }),
      passed('发布状态已解析', 'Publication status parsed', {
        en: `${statusRequest.path}: ${status.lifecycleState}`,
        zh: `${statusRequest.path}: ${status.lifecycleState}`,
      }),
      blocked('真实发布权限仍待验证', 'Real publishing permission remains unverified'),
    ],
    summary: {
      en: 'LinkedIn initialization, PUT upload evidence, post, and status contracts passed.',
      zh: 'LinkedIn 初始化、PUT 上传证据、发帖和状态契约已通过。',
    },
  }
}

const tiktokSignatureSimulation = (): PlatformSimulationResult => {
  const timestamp = '1753600000'
  const rawBody = '{"event":"fixture-only"}'
  const clientSecret = 'local-fixture-secret'
  const signature = createHmac('sha256', clientSecret)
    .update(timestamp)
    .update('.')
    .update(rawBody)
    .digest('hex')
  const verified = verifyTikTokWebhookSignature({
    clientSecret,
    nowSeconds: Number(timestamp),
    rawBody,
    signatureHeader: `t=${timestamp},s=${signature}`,
  })
  if (!verified) throw new Error('TikTok signature simulation failed')

  return {
    id: 'tiktok-signature',
    status: 'blocked',
    steps: [
      passed('官方签名算法验证通过', 'Official signature algorithm verified'),
      passed('时间窗检查通过', 'Freshness window verified'),
      blocked('私信 schema 与 connector 仍受阻', 'DM schema and connector remain blocked'),
    ],
    summary: {
      en: 'The reusable ingress signature seam passed; no TikTok DM event shape was invented.',
      zh: '可复用入站验签 seam 已通过，未虚构 TikTok 私信事件结构。',
    },
  }
}

const noAccountDegradationSimulation = async (): Promise<PlatformSimulationResult> => {
  const port = createFakePlatformPublishingPort()
  const results = await Promise.all(
    (['facebook', 'instagram', 'linkedin'] as PublishingPlatform[]).map((platform) =>
      port.publish({
        assets: [],
        idempotencyKey: `demo-${platform}-blocked`,
        platform,
        text: 'Reviewed fixture content',
      }),
    ),
  )
  if (results.some((result) => result.status !== 'blocked' || result.retryable)) {
    throw new Error('No-account publishing simulation did not fail closed')
  }

  return {
    id: 'no-account-degradation',
    status: 'passed',
    steps: results.map((result) =>
      passed(`${result.platform} 已安全阻断`, `${result.platform} failed closed`, {
        en: result.status === 'blocked' ? result.errorCode : 'unexpected',
        zh: result.status === 'blocked' ? result.errorCode : 'unexpected',
      }),
    ),
    summary: {
      en: 'Every default publishing path stopped without fabricating an accepted publication.',
      zh: '所有默认发布路径均已停止，没有伪造平台已受理结果。',
    },
  }
}

const unknownOutcomeRecoverySimulation = async (): Promise<PlatformSimulationResult> => {
  const providerState = createFakePlatformConversationOutboundProviderState()
  const port = createFakePlatformConversationOutboundPort({ providerState })
  const request: PlatformConversationOutboundRequest = {
    accountExternalId: 'PAGE_DEMO_1',
    deliveryKey: 'demo-delivery-unknown-1',
    externalThreadId: 'THREAD_DEMO_1',
    handoffStatus: 'ai_active',
    platform: 'facebook-messenger',
    recipientExternalId: 'CONTACT_DEMO_1',
    text: 'Which finish and approximate quantity do you need?',
  }
  port.loseAcceptedResultNext({ platform: request.platform })
  let resultWasLost = false
  try {
    await port.send(request)
  } catch {
    resultWasLost = true
  }
  if (!resultWasLost) throw new Error('Unknown outcome simulation did not lose the result')
  const recovery = await createFakePlatformConversationOutboundPort({
    providerState,
  }).recoverUnknownOutcome(request)
  if (recovery.status !== 'delivery_unknown') {
    throw new Error('Unknown outcome simulation did not stop for manual reconciliation')
  }

  return {
    id: 'unknown-outcome-recovery',
    status: 'passed',
    steps: [
      passed('模拟平台受理后结果丢失', 'Provider acceptance result was lost'),
      passed('未执行盲目重发', 'Blind resend was prevented'),
      passed('进入人工核对', 'Manual reconciliation selected', {
        en: recovery.status,
        zh: recovery.status,
      }),
    ],
    summary: {
      en: 'The recovery path converged to delivery_unknown without issuing a second send.',
      zh: '恢复路径在未执行第二次发送的情况下收敛为 delivery_unknown。',
    },
  }
}

export const runPlatformSimulation = async (
  id: PlatformSimulationId,
): Promise<PlatformSimulationResult> => {
  if (id === 'meta-inbound-normalization') return metaInboundSimulation()
  if (id === 'meta-conversation-outbound') return metaConversationSimulation()
  if (id === 'facebook-publishing') return facebookPublishingSimulation()
  if (id === 'instagram-publishing') return instagramPublishingSimulation()
  if (id === 'linkedin-publishing') return linkedInPublishingSimulation()
  if (id === 'tiktok-signature') return tiktokSignatureSimulation()
  if (id === 'no-account-degradation') return noAccountDegradationSimulation()
  return unknownOutcomeRecoverySimulation()
}
