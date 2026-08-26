import { randomBytes } from 'node:crypto'

import type { SmokeLocale } from './config'

export type CanaryData = {
  chatMessages: [string, string, string]
  company: string
  country: string
  email: string
  message: string
  name: string
  operatorReply: string
  phone: string
  runId: string
}

export const generateRunId = (
  now: Date = new Date(),
  randomSuffix: string = randomBytes(3).toString('hex'),
): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const year = now.getUTCFullYear()
  const month = pad(now.getUTCMonth() + 1)
  const day = pad(now.getUTCDate())
  const hours = pad(now.getUTCHours())
  const minutes = pad(now.getUTCMinutes())
  const seconds = pad(now.getUTCSeconds())

  return `canary-${year}${month}${day}-${hours}${minutes}${seconds}-${randomSuffix.slice(0, 6)}`
}

export const generateCanaryData = (runId: string, locale: SmokeLocale): CanaryData => {
  if (locale === 'ar') {
    const email = `canary-${runId}-ar@example.invalid`
    const company = `شركة اختبار الواجهات ${runId}`
    return {
      chatMessages: [
        `نحتاج aluminum panels لمشروع في الإمارات العربية المتحدة. [CANARY ${runId}]`,
        `اسم الشركة: ${company}، المشروع في مرحلة تصميم ونحتاج 300 م².`,
        `لدينا رسومات. الميزانية: 100000 دولار وخطة الشراء جاهزة. الشراء خلال 3 أشهر. البريد ${email}. [CANARY ${runId}]`,
      ],
      company,
      country: 'United Arab Emirates',
      email,
      message: `[CANARY ${runId}] اختبار فحص تلقائي. لا يلزم متابعة.`,
      name: `عميل اختبار ${runId}`,
      operatorReply: `[CANARY ${runId}] رد المشغل التجريبي.`,
      phone: '+971501234567',
      runId,
    }
  }

  const email = `canary-${runId}@example.invalid`
  const company = `Canary Facade ${runId}`
  return {
    chatMessages: [
      `We need aluminum facade panels for a project in the United Arab Emirates. [CANARY ${runId}]`,
      `Company: ${company}. The project is at design stage and needs 300 m2.`,
      `We have drawings. Budget is USD 100000 and our purchase plan is approved. We will buy in 3 months. Email ${email}. [CANARY ${runId}]`,
    ],
    company,
    country: 'United Arab Emirates',
    email,
    message: `[CANARY ${runId}] Automated workflow smoke. No follow-up required.`,
    name: `Canary Buyer ${runId}`,
    operatorReply: `[CANARY ${runId}] Test operator reply.`,
    phone: '+971501234567',
    runId,
  }
}
