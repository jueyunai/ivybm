import { describe, expect, it, vi } from 'vitest'

import { createLeaseRenewalProgress } from '@/modules/knowledge/jobs'

describe('knowledge index job progress', () => {
  it('renews the worker lease periodically during long persistence work', async () => {
    const renewLease = vi.fn().mockResolvedValue({})
    const onProgress = createLeaseRenewalProgress({ renewLease }, 3)

    await onProgress()
    await onProgress()
    expect(renewLease).not.toHaveBeenCalled()

    await onProgress()
    await onProgress()
    await onProgress()
    await onProgress()
    expect(renewLease).toHaveBeenCalledTimes(2)
  })

  it('rejects an invalid renewal interval', () => {
    expect(() => createLeaseRenewalProgress({ renewLease: vi.fn() }, 0)).toThrow('positive integer')
  })
})
