import {
  JobLeaseLostError,
  JobQueueError,
  type ClaimedJob,
  type JobHandler,
  type JobQueue,
} from './contracts'

export const DEFAULT_JOB_POLL_INTERVAL_MS = 1_000
export const DEFAULT_JOB_HEARTBEAT_INTERVAL_MS = 30_000

export type JobWorkerOptions = {
  handlers: Record<string, JobHandler>
  heartbeatIntervalMs?: number
  idleDelayMs?: number
  queue: JobQueue
}

export class JobWorker {
  private readonly handlers: Record<string, JobHandler>
  private readonly heartbeatIntervalMs: number
  private readonly idleDelayMs: number
  private readonly queue: JobQueue
  private stopRequested = false

  constructor(options: JobWorkerOptions) {
    this.handlers = options.handlers
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_JOB_HEARTBEAT_INTERVAL_MS
    this.idleDelayMs = options.idleDelayMs ?? DEFAULT_JOB_POLL_INTERVAL_MS
    this.queue = options.queue

    if (!Number.isInteger(this.idleDelayMs) || this.idleDelayMs < 1) {
      throw new RangeError('idleDelayMs must be a positive integer')
    }
    if (!Number.isInteger(this.heartbeatIntervalMs) || this.heartbeatIntervalMs < 1) {
      throw new RangeError('heartbeatIntervalMs must be a positive integer')
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
      try {
        await this.queue.fail({
          error: new Error(`No handler is registered for job type "${job.type}"`),
          job,
        })
      } catch (error) {
        if (!(error instanceof JobQueueError) || error.code !== 'conflict') throw error
      }
      return 'failed'
    }

    const controller = new AbortController()
    let heartbeatPromise: Promise<void> | undefined
    let leaseLost: JobLeaseLostError | undefined

    const loseLease = (error: unknown): JobLeaseLostError => {
      leaseLost ??= new JobLeaseLostError(`Job ${job.id} lease was lost`, error)
      if (!controller.signal.aborted) controller.abort(leaseLost)
      return leaseLost
    }
    const assertLease = (): void => {
      if (leaseLost) throw leaseLost
      if (controller.signal.aborted) {
        throw new JobLeaseLostError(`Job ${job.id} execution was aborted`, controller.signal.reason)
      }
    }
    const renewLease = async (): Promise<ClaimedJob> => {
      assertLease()
      try {
        return await this.queue.renew(job)
      } catch (error) {
        throw loseLease(error)
      }
    }
    const heartbeat = setInterval(() => {
      if (heartbeatPromise || leaseLost) return
      heartbeatPromise = renewLease()
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          heartbeatPromise = undefined
        })
    }, this.heartbeatIntervalMs)

    try {
      await handler(job, { assertLease, renewLease, signal: controller.signal })
      clearInterval(heartbeat)
      if (heartbeatPromise) await heartbeatPromise
      assertLease()
      await this.queue.complete(job)
      return 'succeeded'
    } catch (error) {
      clearInterval(heartbeat)
      if (heartbeatPromise) await heartbeatPromise
      if (
        leaseLost ||
        error instanceof JobLeaseLostError ||
        (error instanceof JobQueueError && error.code === 'conflict')
      ) {
        return 'failed'
      }
      try {
        await this.queue.fail({
          error: error instanceof Error ? error : new Error(String(error)),
          job,
        })
      } catch (failureError) {
        if (failureError instanceof JobQueueError && failureError.code === 'conflict') {
          return 'failed'
        }
        throw failureError
      }
      return 'failed'
    } finally {
      clearInterval(heartbeat)
      if (heartbeatPromise) await heartbeatPromise
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
