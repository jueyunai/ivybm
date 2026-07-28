import type { Locale } from './i18n'

type ComparisonRow = { actual: string; nominal: string }

const THICKNESS_REFERENCE: Record<
  Locale,
  {
    caption: string
    headers: [string, string]
    imageAlt: string
    imageCaption: string
    note: string
    rows: ComparisonRow[]
    title: string
  }
> = {
  en: {
    caption: 'Legacy IVY nominal-to-base-material thickness comparison',
    headers: ['Nominal thickness', 'Actual base-material thickness'],
    imageAlt: 'Aluminum panel samples shown in the legacy IVY thickness article',
    imageCaption: 'Panel samples photographed for the article on the previous IVY website.',
    note:
      'Historical reference published by IVY on 13 April 2026. The source page does not cite a test method or governing standard for these measured values. Confirm the project standard, tolerances, alloy, temper, coating, panel size, loads, and inspection method before ordering.',
    rows: [
      { nominal: '1.5 mm', actual: '1.35 mm' },
      { nominal: '2.0 mm', actual: '1.85 mm' },
      { nominal: '2.5 mm', actual: '2.35 mm' },
      { nominal: '3.0 mm', actual: '2.85 mm' },
      { nominal: '4.0 mm', actual: '3.9 mm' },
      { nominal: '5.0 mm', actual: '5.0 mm — custom sheet' },
    ],
    title: 'Archived thickness comparison table',
  },
  ar: {
    caption: 'مقارنة IVY التاريخية بين السماكة الاسمية وسماكة المادة الأساسية',
    headers: ['السماكة الاسمية', 'السماكة الفعلية للمادة الأساسية'],
    imageAlt: 'عينات ألواح الألمنيوم في مقال السماكة التاريخي من IVY',
    imageCaption: 'عينات ألواح صُورت للمقال المنشور في موقع IVY السابق.',
    note:
      'مرجع تاريخي نشرته IVY في 13 أبريل 2026. لا تذكر صفحة المصدر طريقة اختبار أو معيارا مرجعيا لهذه القيم المقاسة. يجب تأكيد معيار المشروع والتفاوتات والسبيكة والحالة الحرارية والطلاء والمقاس والأحمال وطريقة الفحص قبل الطلب.',
    rows: [
      { nominal: '1.5 مم', actual: '1.35 مم' },
      { nominal: '2.0 مم', actual: '1.85 مم' },
      { nominal: '2.5 مم', actual: '2.35 مم' },
      { nominal: '3.0 مم', actual: '2.85 مم' },
      { nominal: '4.0 مم', actual: '3.9 مم' },
      { nominal: '5.0 مم', actual: '5.0 مم — لوح مخصص' },
    ],
    title: 'جدول مقارنة السماكات المؤرشف',
  },
}

export const getLegacyArticleReference = (locale: Locale, slug: string) =>
  slug === 'aluminum-panel-thickness-guide' ? THICKNESS_REFERENCE[locale] : null
