import {
  PublishingContractValidationError,
  normalizePlatformPublishRequest,
} from '../publishing/contracts'
import {
  executeLinkedInImagePublishingStage,
  type LinkedInImageAssetReader,
  type LinkedInImagePublishingAuthorityPort,
  type LinkedInImagePublishingIntent,
  type LinkedInImagePublishingLeaseFence,
  type LinkedInImagePublishingTransition,
} from './linkedin/imagePublishingExecution'
import type { LinkedInPublishingTransport } from './linkedin/publishingOutbound'
import {
  executeInstagramPublishingStage,
  type InstagramPublishingAuthorityPort,
  type InstagramPublishingIntent,
  type InstagramPublishingLeaseFence,
  type InstagramPublishingTransition,
} from './meta/instagramPublishingExecution'
import type { MetaPublishingTransport } from './meta/publishingOutbound'
import {
  executeLeaseFencedPublication,
  type PlatformPublicationAuthorityPort,
  type PlatformPublicationExecutionResult,
  type PlatformPublicationIntent,
  type PlatformPublicationLeaseFence,
} from './publishingAuthority'
import type { PublishingService } from '../publishing/contracts'

export const PUBLICATION_WORKER_ROUTES = [
  'facebook-photo-single',
  'instagram-image-staged',
  'linkedin-text-single',
  'linkedin-image-staged',
] as const

export type PublicationWorkerRoute = (typeof PUBLICATION_WORKER_ROUTES)[number]

export type FacebookPhotoPublicationWorkItem = {
  authority: PlatformPublicationAuthorityPort
  intent: PlatformPublicationIntent
  leaseFence: PlatformPublicationLeaseFence
  route: 'facebook-photo-single'
  service: PublishingService
}

export type InstagramImagePublicationWorkItem = {
  authority: InstagramPublishingAuthorityPort
  intent: InstagramPublishingIntent
  leaseFence: InstagramPublishingLeaseFence
  route: 'instagram-image-staged'
  transport: MetaPublishingTransport
}

export type LinkedInTextPublicationWorkItem = {
  authority: PlatformPublicationAuthorityPort
  intent: PlatformPublicationIntent
  leaseFence: PlatformPublicationLeaseFence
  route: 'linkedin-text-single'
  service: PublishingService
}

export type LinkedInImagePublicationWorkItem = {
  authority: LinkedInImagePublishingAuthorityPort
  intent: LinkedInImagePublishingIntent
  leaseFence: LinkedInImagePublishingLeaseFence
  readAssetBytes?: LinkedInImageAssetReader
  route: 'linkedin-image-staged'
  transport: LinkedInPublishingTransport
}

export type PublicationWorkerItem =
  | FacebookPhotoPublicationWorkItem
  | InstagramImagePublicationWorkItem
  | LinkedInImagePublicationWorkItem
  | LinkedInTextPublicationWorkItem

export type PublicationWorkerDispatchResult =
  | {
      result: PlatformPublicationExecutionResult
      route: 'facebook-photo-single' | 'linkedin-text-single'
    }
  | { result: InstagramPublishingTransition; route: 'instagram-image-staged' }
  | { result: LinkedInImagePublishingTransition; route: 'linkedin-image-staged' }

export type PublicationWorkerExecutors = {
  executeInstagram: typeof executeInstagramPublishingStage
  executeLinkedInImage: typeof executeLinkedInImagePublishingStage
  executeSingle: typeof executeLeaseFencedPublication
}

const defaultExecutors: PublicationWorkerExecutors = {
  executeInstagram: executeInstagramPublishingStage,
  executeLinkedInImage: executeLinkedInImagePublishingStage,
  executeSingle: executeLeaseFencedPublication,
}

const invalid = (message: string): never => {
  throw new PublishingContractValidationError(message)
}

const directRequest = (
  item: FacebookPhotoPublicationWorkItem | LinkedInTextPublicationWorkItem,
) => {
  if (
    !item.intent ||
    typeof item.intent !== 'object' ||
    !item.leaseFence ||
    typeof item.leaseFence !== 'object'
  ) {
    return invalid('Publication worker direct intent is invalid')
  }
  const request = normalizePlatformPublishRequest(item.intent.snapshot)
  if (request.scheduledFor) {
    return invalid('Publication worker only accepts user-triggered immediate commands')
  }
  return { request, status: item.intent.snapshot.status }
}

const assertDirectRoute = (
  item: FacebookPhotoPublicationWorkItem | LinkedInTextPublicationWorkItem,
): void => {
  const { request } = directRequest(item)
  if (item.route === 'facebook-photo-single') {
    const [asset] = request.assets
    if (
      request.platform !== 'facebook' ||
      request.assets.length !== 1 ||
      !asset ||
      (asset.mimeType !== 'image/jpeg' && asset.mimeType !== 'image/png') ||
      !asset.sourceUrl
    ) {
      invalid('Facebook publication worker requires exactly one JPEG or PNG URL asset')
    }
    return
  }
  if (request.platform !== 'linkedin' || request.assets.length !== 0) {
    invalid('LinkedIn text publication worker does not accept media assets')
  }
}

const assertInstagramRoute = (item: InstagramImagePublicationWorkItem): void => {
  if (
    !item.intent ||
    item.intent.platform !== 'instagram' ||
    !item.leaseFence ||
    !item.intent.checkpoint ||
    typeof item.intent.checkpoint.imageUrl !== 'string' ||
    !item.intent.checkpoint.imageUrl
  ) {
    invalid('Instagram publication worker intent is invalid')
  }
}

const assertLinkedInImageRoute = (item: LinkedInImagePublicationWorkItem): void => {
  if (
    !item.intent ||
    item.intent.platform !== 'linkedin' ||
    !item.leaseFence ||
    !item.intent.checkpoint ||
    !item.intent.asset
  ) {
    invalid('LinkedIn image publication worker intent is invalid')
  }
  const requiresBytes = item.intent.checkpoint.stage === 'image_initialized'
  if (requiresBytes !== (typeof item.readAssetBytes === 'function')) {
    invalid(
      requiresBytes
        ? 'LinkedIn image upload stage requires an asset reader'
        : 'LinkedIn image worker accepts an asset reader only during the upload stage',
    )
  }
}

/**
 * Strict worker boundary for the four MVP publishing shapes. It selects an
 * existing lease-fenced executor only after the persisted route matches the
 * platform and asset shape. Provider I/O remains inside those executors.
 */
export const dispatchPublicationWorkItem = async (
  item: PublicationWorkerItem,
  executors: PublicationWorkerExecutors = defaultExecutors,
): Promise<PublicationWorkerDispatchResult> => {
  if (!item || typeof item !== 'object' || !PUBLICATION_WORKER_ROUTES.includes(item.route)) {
    return invalid('Publication worker route is invalid')
  }
  if (
    !executors ||
    typeof executors.executeInstagram !== 'function' ||
    typeof executors.executeLinkedInImage !== 'function' ||
    typeof executors.executeSingle !== 'function'
  ) {
    return invalid('Publication worker executors are invalid')
  }

  if (item.route === 'facebook-photo-single' || item.route === 'linkedin-text-single') {
    assertDirectRoute(item)
    return {
      result: await executors.executeSingle({
        authority: item.authority,
        intent: item.intent,
        leaseFence: item.leaseFence,
        service: item.service,
      }),
      route: item.route,
    }
  }
  if (item.route === 'instagram-image-staged') {
    assertInstagramRoute(item)
    return {
      result: await executors.executeInstagram({
        authority: item.authority,
        intent: item.intent,
        leaseFence: item.leaseFence,
        transport: item.transport,
      }),
      route: item.route,
    }
  }

  assertLinkedInImageRoute(item)
  return {
    result: await executors.executeLinkedInImage({
      authority: item.authority,
      intent: item.intent,
      leaseFence: item.leaseFence,
      ...(item.readAssetBytes ? { readAssetBytes: item.readAssetBytes } : {}),
      transport: item.transport,
    }),
    route: item.route,
  }
}
