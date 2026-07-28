import { localePath, type Locale } from './i18n'

type EvidenceLink = { href: string; label: string }
type FAQ = { answer: string; question: string }
type ReferenceRow = { label: string; value: string }

const COPY = {
  en: {
    evidenceTitle: 'Project and technical evidence',
    legacyReferenceCaption: 'Archived IVY catalogue data — project confirmation required',
    legacyReferenceNote:
      'The following product-family values are reproduced from the previous IVY product page for traceability. They are not a current offer, tolerance, or compliance statement. Confirm every value against approved drawings, samples, current certificates, engineering review, and the contract.',
    legacyReferenceRows: [
      { label: 'Product family', value: 'Facade and cladding panels' },
      { label: 'Forms listed', value: 'Solid, mashrabiya / partition, and curved panels' },
      {
        label: 'Legacy size reference',
        value: 'TH 1.2–20 mm; maximum 1500 × 6000 mm — historical catalogue range only',
      },
      {
        label: 'Geometry listed',
        value: 'Perforated, single-curved, double-curved, and hollow sections',
      },
      {
        label: 'Surface options listed',
        value: 'Anodized, powder / polyester / PVDF coating, and wood or stone effects',
      },
      { label: 'Color references', value: 'RAL, NCS, or PMS reference systems' },
      {
        label: 'Applications listed',
        value: 'Curtain wall, cladding, lattice, partitions, and mashrabiya',
      },
    ] satisfies ReferenceRow[],
    legacyReferenceTitle: 'Legacy product reference',
    productStoryTitle: 'Legacy project and fabrication imagery',
    faqTitle: 'Questions buyers usually ask',
    faqs: [
      {
        question: 'Can the geometry and dimensions be customized?',
        answer:
          'Yes. Feasibility is reviewed against the approved drawings or 3D model, panelization, support interfaces, transport limits, and fabrication requirements before a final commitment is made.',
      },
      {
        question: 'Which finishes are available?',
        answer:
          'Anodized, powder, liquid coating, metallic, and decorative transfer options can be reviewed. The final system, color, gloss, texture, batch range, and warranty must follow the approved sample, current supporting documents, and project specification.',
      },
      {
        question: 'What should an enquiry include?',
        answer:
          'Send drawings or a 3D model, panel schedule and quantity, dimensions or radius, alloy or governing specification, finish reference, support and joint concept, destination, packing requirements, and target delivery date.',
      },
      {
        question: 'Can project documentation and samples be coordinated?',
        answer:
          'Shop drawings, material or color samples, first articles, visual or performance mock-ups, inspection records, labels, packing lists, and shipping documents can be coordinated when included in the agreed project scope.',
      },
    ] satisfies FAQ[],
    procurementKicker: 'Procurement brief',
    quoteAction: 'Request project review and quotation',
    quoteBody:
      'A useful quotation starts with the geometry, specification, quantity, interfaces, finish, destination, and required delivery sequence.',
    quoteItems: [
      'Approved drawings, 3D model, or physical sample',
      'Panel schedule, dimensions, radius, and quantity',
      'Material, finish, color sample, and governing specification',
      'Support, fixing, joint, and acceptance requirements',
      'Project location, packing, logistics, and target date',
    ],
    quoteTitle: 'Prepare a review-ready RFQ',
    snapshotNote:
      'Values below are reference starting points from historical material. Final parameters are governed by approved drawings, samples, current certificates, engineering review, and the contract.',
    snapshotTitle: 'Technical snapshot',
    specificationCaption: 'Reference product specifications',
  },
  ar: {
    evidenceTitle: 'أدلة المشاريع والمحتوى الفني',
    legacyReferenceCaption: 'بيانات كتالوج IVY المؤرشفة — يلزم تأكيد المشروع',
    legacyReferenceNote:
      'القيم التالية من صفحة منتجات IVY السابقة لأغراض التتبع، ولا تعد عرضا حاليا أو تفاوتا أو بيانا للمطابقة. يجب تأكيد كل قيمة مقابل الرسومات والعينات المعتمدة والشهادات الحالية والمراجعة الهندسية والعقد.',
    legacyReferenceRows: [
      { label: 'فئة المنتج', value: 'ألواح الواجهات والكسوة' },
      { label: 'الأشكال المذكورة', value: 'ألواح مصمتة ومشربيات / قواطع وألواح منحنية' },
      {
        label: 'مرجع المقاس التاريخي',
        value: 'سماكة 1.2–20 مم؛ حد أقصى 1500 × 6000 مم — نطاق كتالوج تاريخي فقط',
      },
      {
        label: 'الأشكال المذكورة',
        value: 'مثقبة وأحادية الانحناء ومزدوجة الانحناء ومقاطع مجوفة',
      },
      {
        label: 'التشطيبات المذكورة',
        value: 'أنودة وطلاء بودرة / بوليستر / PVDF وتأثيرات خشبية أو حجرية',
      },
      { label: 'مراجع الألوان', value: 'أنظمة مراجع RAL أو NCS أو PMS' },
      {
        label: 'الاستخدامات المذكورة',
        value: 'الجدران الستارية والكسوة والشبكات والقواطع والمشربيات',
      },
    ] satisfies ReferenceRow[],
    legacyReferenceTitle: 'مرجع المنتج التاريخي',
    productStoryTitle: 'صور المشاريع والتصنيع من الموقع السابق',
    faqTitle: 'أسئلة يطرحها المشترون عادة',
    faqs: [
      {
        question: 'هل يمكن تخصيص الشكل والأبعاد؟',
        answer:
          'نعم. تتم مراجعة قابلية التصنيع مقابل الرسومات أو النموذج ثلاثي الأبعاد المعتمد وتقسيم الألواح ونقاط الدعم وحدود النقل ومتطلبات التصنيع قبل تقديم التزام نهائي.',
      },
      {
        question: 'ما التشطيبات المتاحة؟',
        answer:
          'يمكن مراجعة الأنودة والطلاء بالبودرة أو السائل والألوان المعدنية وخيارات نقل الشكل الزخرفي. ويجب أن يتبع النظام واللون واللمعان والملمس ونطاق الدفعة والضمان العينة المعتمدة والوثائق الحالية ومواصفات المشروع.',
      },
      {
        question: 'ما الذي يجب أن يتضمنه طلب التسعير؟',
        answer:
          'أرسل الرسومات أو النموذج ثلاثي الأبعاد وجدول الألواح والكمية والأبعاد أو نصف القطر والسبيكة أو المواصفة المرجعية ومرجع التشطيب ونظام الدعم والفواصل والوجهة والتغليف وموعد التسليم المستهدف.',
      },
      {
        question: 'هل يمكن تنسيق وثائق المشروع والعينات؟',
        answer:
          'يمكن تنسيق الرسومات التنفيذية وعينات المادة أو اللون والعينة الأولى والنماذج البصرية أو نماذج الأداء وسجلات الفحص والملصقات وقوائم التعبئة ووثائق الشحن عندما تكون ضمن نطاق المشروع المتفق عليه.',
      },
    ] satisfies FAQ[],
    procurementKicker: 'ملخص للمشتريات',
    quoteAction: 'اطلب مراجعة المشروع وعرض السعر',
    quoteBody:
      'يبدأ عرض السعر المفيد من الشكل والمواصفة والكمية ونقاط الربط والتشطيب والوجهة وتسلسل التسليم المطلوب.',
    quoteItems: [
      'الرسومات المعتمدة أو النموذج ثلاثي الأبعاد أو العينة الفعلية',
      'جدول الألواح والأبعاد ونصف القطر والكمية',
      'المادة والتشطيب وعينة اللون والمواصفة المرجعية',
      'متطلبات الدعم والتثبيت والفواصل والقبول',
      'موقع المشروع والتغليف واللوجستيات والموعد المستهدف',
    ],
    quoteTitle: 'جهز طلب تسعير قابلا للمراجعة',
    snapshotNote:
      'القيم أدناه نقاط مرجعية من المواد التاريخية. وتحكم المعايير النهائية الرسومات والعينات المعتمدة والشهادات الحالية والمراجعة الهندسية والعقد.',
    snapshotTitle: 'ملخص فني',
    specificationCaption: 'مواصفات مرجعية للمنتج',
  },
} as const

const STORY_CAPTIONS: Record<string, Record<Locale, string[]>> = {
  'double-curved-aluminum-panel': {
    en: [
      'Double-curved panels on a spherical landmark',
      'Double-curved aluminum facade application',
      'Free-form double-curved building envelope',
      'Double-curved panels on sculptural architecture',
    ],
    ar: [
      'ألواح مزدوجة الانحناء على معلم كروي',
      'تطبيق واجهة بألواح ألمنيوم مزدوجة الانحناء',
      'غلاف مبنى حر الشكل مزدوج الانحناء',
      'ألواح مزدوجة الانحناء على مبنى نحتي',
    ],
  },
  'single-curved-aluminum-panel': {
    en: [
      'Single-curved panels installed in an interior ceiling',
      'Curved aluminum cladding on a public building',
      'Single-curved aluminum facade canopy',
      'Curved aluminum ceiling application',
    ],
    ar: [
      'ألواح أحادية الانحناء مركبة في سقف داخلي',
      'كسوة ألمنيوم منحنية على مبنى عام',
      'مظلة واجهة بألواح ألمنيوم أحادية الانحناء',
      'تطبيق سقف بألواح ألمنيوم منحنية',
    ],
  },
  'solid-aluminum-panel': {
    en: [
      'Standard aluminum panel construction detail',
      'Standard aluminum panel fabrication workflow',
      'RAL color selection for aluminum facade panels',
      'Standard aluminum panels on a commercial facade',
    ],
    ar: [
      'تفاصيل تصنيع لوح ألمنيوم قياسي',
      'مسار تصنيع ألواح الألمنيوم القياسية',
      'اختيار ألوان RAL لألواح الواجهات',
      'ألواح ألمنيوم قياسية على واجهة تجارية',
    ],
  },
}

const EVIDENCE: Record<string, Record<Locale, EvidenceLink[]>> = {
  'double-curved-aluminum-panel': {
    en: [
      { href: '/projects/canada-double-curved', label: 'Canada double-curved project' },
      {
        href: '/news/what-is-double-curved-aluminum-panel',
        label: 'How double-curved panels are made',
      },
      {
        href: '/news/aluminum-panel-surface-treatments',
        label: 'Surface finish control guide',
      },
    ],
    ar: [
      { href: '/projects/canada-double-curved', label: 'مشروع الألواح مزدوجة الانحناء في كندا' },
      {
        href: '/news/what-is-double-curved-aluminum-panel',
        label: 'طريقة تصنيع الألواح مزدوجة الانحناء',
      },
      { href: '/news/aluminum-panel-surface-treatments', label: 'دليل ضبط التشطيبات' },
    ],
  },
  'single-curved-aluminum-panel': {
    en: [
      { href: '/projects/shunde-gymnasium', label: 'Shunde curved cladding project' },
      {
        href: '/news/aluminum-panel-surface-treatments',
        label: 'Surface finish control guide',
      },
      { href: '/news/aluminum-panel-thickness-guide', label: 'Panel thickness review guide' },
    ],
    ar: [
      { href: '/projects/shunde-gymnasium', label: 'مشروع الكسوة المنحنية في ملعب شونده' },
      { href: '/news/aluminum-panel-surface-treatments', label: 'دليل ضبط التشطيبات' },
      { href: '/news/aluminum-panel-thickness-guide', label: 'دليل مراجعة سماكة الألواح' },
    ],
  },
  'solid-aluminum-panel': {
    en: [
      { href: '/projects', label: 'Browse installed and factory project references' },
      {
        href: '/news/aluminum-panel-surface-treatments',
        label: 'Surface finish control guide',
      },
      { href: '/news/aluminum-panel-thickness-guide', label: 'Panel thickness review guide' },
    ],
    ar: [
      { href: '/projects', label: 'استعرض مراجع المشاريع والتركيب والمصنع' },
      { href: '/news/aluminum-panel-surface-treatments', label: 'دليل ضبط التشطيبات' },
      { href: '/news/aluminum-panel-thickness-guide', label: 'دليل مراجعة سماكة الألواح' },
    ],
  },
}

export const getProductProcurementContent = (locale: Locale, slug: string) => ({
  ...COPY[locale],
  evidence: (EVIDENCE[slug]?.[locale] ?? []).map((item) => ({
    ...item,
    href: localePath(locale, item.href),
  })),
  storyCaptions: STORY_CAPTIONS[slug]?.[locale] ?? [],
  quoteHref: `${localePath(locale, '/contact')}?product=${encodeURIComponent(slug)}`,
})
