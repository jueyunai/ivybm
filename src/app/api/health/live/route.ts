import { NextResponse } from 'next/server'

import { getHealth } from '@/lib/health'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getHealth())
}
