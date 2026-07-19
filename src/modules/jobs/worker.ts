import type { JobHandler, JobQueue } from './contracts'

export const DEFAULT_JOB_POLL_INTERVAL_MS = 1_000

export type JobWorkerOptions = {
  handlers: Record<string, JobHandler>
  idleDelayMs?: number
  queue: JobQueue
}

export class JobWorker {
  private readonly handlers: Record<string, JobHandler>
  private readonly idleDelayMs: number
  private readonly queue: JobQueue
  private stopRequested = false

  constructor(options: JobWorkerOptions) {
    this.handlers = options.handlers
    this.idleDelayMs = options.idleDelayMs ?? DEFAULT_JOB_POLL_INTERVAL_MS
    this.queue = options.queue

    if (!Number.isInteger(this.idleDelayMs) || this.idleDelayMs < 1) {
      throw new RangeError('idleDelayMs must be a positive integer')
    }
  }

  stop(): void {
    this.stopRequested = true
  }

  async runOnce(): Promise<'failed' | 'idle' | 'succeeded'> {
    const job = await this.queue.claimNext()
    if (!job) return 'idle'

    const handler = this.handlers[job.type]
    if (!handler) {
      await this.queue.fail({
        error: new Error(`No handler is registered for job type "${job.type}"`),
        job,
      })
      return 'failed'
    }

    try {
      await handler(job, {
        renewLease: () => this.queue.renew(job),
      })
      await this.queue.complete(job)
      return 'succeeded'
    } catch (error) {
      await this.queue.fail({
        error: error instanceof Error ? error : new Error(String(error)),
        job,
      })
      return 'failed'
    }
  }

  async runUntilStopped(onHeartbeat?: () => Promise<void>): Promise<void> {
    while (!this.stopRequested) {
      await onHeartbeat?.()
      const outcome = await this.runOnce()
      if (outcome === 'idle') {
        await new Promise<void>((resolve) => setTimeout(resolve, this.idleDelayMs))
      }
    }
  }
}
