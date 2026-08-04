import { describe, expect, it, vi } from 'vitest'

import { createContentStudioLinkedInPackage } from '@/admin-portal/modules/content-studio/linkedinPackage'

const content = (assets: Record<string, unknown>[]) => ({
  assets,
  body: 'Approved LinkedIn copy',
  id: 1,
  platform: 'linkedin',
  status: 'approved',
})

describe('Portal LinkedIn package loading budget', () => {
  it('rejects too many assets before inspecting or reading files', async () => {
    const fileSystem = { createReadStream: vi.fn(), stat: vi.fn() }
    const payload = {
      findByID: vi.fn().mockResolvedValue(
        content(
          Array.from({ length: 101 }, (_, index) => ({
            filename: `asset-${index}.png`,
            id: index + 1,
            mimeType: 'image/png',
          })),
        ),
      ),
    }

    await expect(
      createContentStudioLinkedInPackage({
        fileSystem: fileSystem as never,
        id: 1,
        payload: payload as never,
        req: {} as never,
      }),
    ).rejects.toMatchObject({ code: 'content-studio-package-too-many-assets', status: 413 })
    expect(fileSystem.stat).not.toHaveBeenCalled()
    expect(fileSystem.createReadStream).not.toHaveBeenCalled()
  })

  it('rejects an oversized total from file metadata before reading bytes', async () => {
    const fileSystem = {
      createReadStream: vi.fn(),
      stat: vi.fn().mockResolvedValue({ isFile: () => true, size: 30 * 1024 * 1024 }),
    }
    const payload = {
      findByID: vi.fn().mockResolvedValue(
        content([
          { filename: 'first.png', id: 1, mimeType: 'image/png' },
          { filename: 'second.png', id: 2, mimeType: 'image/png' },
        ]),
      ),
    }
    await expect(
      createContentStudioLinkedInPackage({
        fileSystem: fileSystem as never,
        id: 1,
        payload: payload as never,
        req: {} as never,
      }),
    ).rejects.toMatchObject({ code: 'content-studio-package-too-large', status: 413 })
    expect(fileSystem.stat).toHaveBeenCalledTimes(2)
    expect(fileSystem.createReadStream).not.toHaveBeenCalled()
  })
})
