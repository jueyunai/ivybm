import type {
  EnqueuePlatformEventResult,
  PersistedPlatformEvent,
  PlatformEventRepository,
} from '../../src/modules/platforms/ports'

export class FakePlatformEventRepository implements PlatformEventRepository {
  readonly events = new Map<string, PersistedPlatformEvent>()

  async enqueueBatch(events: PersistedPlatformEvent[]): Promise<EnqueuePlatformEventResult[]> {
    const knownDigests = new Map(
      [...this.events].map(([key, persisted]) => [key, persisted.eventDigest]),
    )

    for (const persisted of events) {
      const key = persisted.event.idempotencyKey
      const knownDigest = knownDigests.get(key)
      if (knownDigest && knownDigest !== persisted.eventDigest) {
        return [{ idempotencyKey: key, status: 'conflict' }]
      }
      knownDigests.set(key, persisted.eventDigest)
    }

    const results: EnqueuePlatformEventResult[] = []
    for (const persisted of events) {
      const key = persisted.event.idempotencyKey
      if (this.events.has(key)) {
        results.push({ idempotencyKey: key, status: 'duplicate' })
        continue
      }

      this.events.set(key, structuredClone(persisted))
      results.push({ idempotencyKey: key, status: 'accepted' })
    }
    return results
  }
}
