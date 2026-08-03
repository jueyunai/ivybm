'use client'

import { useState } from 'react'

export const createPortalCommandKeySession = (
  prefix: string,
  createID: () => string = () => crypto.randomUUID(),
) => {
  let active: { fingerprint: string; key: string } | null = null

  return {
    key(fingerprint: string): string {
      if (!active || active.fingerprint !== fingerprint) {
        active = { fingerprint, key: `${prefix}:${createID()}` }
      }
      return active.key
    },
    receivedResponse(key: string): void {
      if (active?.key === key) active = null
    },
  }
}

export const usePortalCommandKey = (prefix: string) =>
  useState(() => createPortalCommandKeySession(prefix))[0]
