import { redirect } from 'next/navigation'

import { DEFAULT_LOCALE, localePath } from '@/lib/i18n'

export default function RootPage() {
  redirect(localePath(DEFAULT_LOCALE))
}
