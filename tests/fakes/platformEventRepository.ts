import type {
  EnqueuePlatformEventResult,
  PlatformEventRepository,
} from '../../src/modules/platforms/ports'
import type { NormalizedPlatformEvent } from '../../src/modules/platforms/types'

export class FakePlatformEventRepository implements PlatformEventRepository {
  readonly events = new Map<string, NormalizedPlatformEvent>()

  async enqueue(event: NormalizedPlatformEvent): Promise<EnqueuePlatformEventResult> {
    if (this.events.has(event.idempotencyKey)) return 'duplicate'
    this.events.set(event.idempotencyKey, structuredClone(event))
    return 'accepted'
  }
}
