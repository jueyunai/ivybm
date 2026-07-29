import { safePortalReturnTo } from './safeReturnTo'

export const PORTAL_REQUEST_PATH_HEADER = 'x-ivybm-portal-path'

export const getPortalRequestPath = (requestHeaders: Headers): string =>
  safePortalReturnTo(requestHeaders.get(PORTAL_REQUEST_PATH_HEADER))
