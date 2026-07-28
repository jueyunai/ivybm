export const PUBLIC_LOCALES = ['en', 'ar'] as const
export const DEFAULT_LOCALE = 'en' as const

export type Locale = (typeof PUBLIC_LOCALES)[number]
export type LocaleDirection = 'ltr' | 'rtl'
export type PostCategory = 'company' | 'industry' | 'products' | 'projects'

export const isPublicLocale = (value: string): value is Locale =>
  PUBLIC_LOCALES.includes(value as Locale)

export const getLocaleDirection = (locale: Locale): LocaleDirection =>
  locale === 'ar' ? 'rtl' : 'ltr'

const normalizePath = (path: string): string => {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '')

  return withoutTrailingSlash || '/'
}

export const localePath = (locale: Locale, path = '/'): string => {
  const normalized = normalizePath(path)

  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`
}

export const replacePathLocale = (pathname: string, locale: Locale): string => {
  const normalized = normalizePath(pathname)
  const segments = normalized.split('/').filter(Boolean)

  if (segments[0] && isPublicLocale(segments[0])) segments.shift()

  return localePath(locale, segments.length ? `/${segments.join('/')}` : '/')
}

export const WEBSITE_COPY = {
  en: {
    accessibility: {
      language: 'Language',
      mainNavigation: 'Main navigation',
      menu: 'Menu',
      mobileNavigation: 'Mobile navigation',
      nextSlide: 'Next slide',
      previousSlide: 'Previous slide',
      whatsapp: 'WhatsApp',
    },
    about: {
      body:
        'IVYBM supports overseas facade procurement with drawing coordination, dimensional checks, surface finish control, export packing, and delivery documentation.',
      kicker: 'Factory Profile',
      processDescription:
        'Material certificates, dimensional checks, coating inspection, color confirmation, trial assembly review, packing protection, and shipment documentation can be coordinated for each project.',
      processTitle: 'Inspection-ready production control',
      stats: [
        ['10+', 'Years facade supply experience'],
        ['120+', 'Project batches supported'],
        ['20+', 'Export markets served'],
      ],
      title: 'Built For Overseas Curtain Wall Procurement',
    },
    actions: {
      allProjects: 'View All Projects',
      contact: 'Contact Us',
      learnMore: 'Learn More',
      quote: 'Get a Quote',
      readMore: 'Read More',
      viewCase: 'View Case',
    },
    chat: {
      assistantAvailable: 'AI project assistant',
      close: 'Close chat',
      greeting: 'Hello — I can help with product information and connect you with our project team.',
      handoffPending: 'Your request has been shared with our project team. A specialist will join shortly.',
      humanActive: 'A project specialist has joined this conversation.',
      launcher: 'Ask our project assistant',
      loading: 'Preparing a secure conversation…',
      newConversation: 'Start a new conversation',
      rateLimited: 'Please wait a moment before trying again.',
      requestHuman: 'Talk to a specialist',
      resolved: 'This conversation has been resolved. Please send a new inquiry if you need more help.',
      retry: 'Retry',
      retryMessage: 'Retry message',
      send: 'Send',
      sending: 'Sending…',
      sources: 'Reviewed sources',
      title: 'Project Assistant',
      unavailable: 'Chat is temporarily unavailable. Please try again.',
      inputPlaceholder: 'Ask about panels, drawings, finishes, or your project…',
    },
    contact: {
      company: 'Company',
      country: 'Country *',
      countryOptions: [
        ['United Arab Emirates', 'United Arab Emirates'],
        ['Saudi Arabia', 'Saudi Arabia'],
        ['Qatar', 'Qatar'],
        ['Oman', 'Oman'],
        ['Kuwait', 'Kuwait'],
        ['United States', 'United States'],
        ['Australia', 'Australia'],
        ['Other', 'Other'],
      ],
      email: 'Email *',
      emailCard: 'Email',
      invalidField: 'Please enter a valid value.',
      interest: 'Product Interest',
      invalidEmail: 'Please enter a valid email address.',
      invalidPhone: 'Please enter a valid international phone number.',
      location: 'Factory Location',
      message: 'Message *',
      messagePlaceholder:
        'Describe drawing status, quantity, surface finish, delivery schedule, and project location.',
      name: 'Name *',
      noScript: 'This form submits securely without JavaScript and will open a confirmation page.',
      phone: 'Phone',
      productOptions: [
        ['double-curved-aluminum-panel', 'Double-Curved Aluminum Panel'],
        ['single-curved-aluminum-panel', 'Single-Curved Aluminum Panel'],
        ['solid-aluminum-panel', 'Standard Facade Aluminum Panel'],
        ['other', 'Other'],
      ],
      required: 'This field is required.',
      received: 'Inquiry received.',
      reference: 'Reference',
      rateLimited: 'Too many submissions. Please wait before trying again.',
      reviewFields: 'Please review the highlighted fields.',
      send: 'Send Inquiry',
      sending: 'Sending…',
      subtitle:
        'Share drawings, quantities, surface finish requirements, or target delivery schedule. Our team will respond within 24 hours.',
      title: 'Send Your Project Inquiry',
      tooLong: 'This value is too long.',
      unavailable: 'The inquiry service is temporarily unavailable. Please retry with the same details.',
      workingHours: 'Working Hours',
      workingHoursValue: 'Monday - Saturday\n09:00 - 18:00 China Standard Time',
    },
    footer: {
      contact: 'Contact',
      quickLinks: 'Quick Links',
      rights: 'All rights reserved.',
    },
    home: {
      advantagesKicker: 'Factory Advantages',
      advantagesSubtitle:
        'IVYBM supports overseas contractors, curtain wall consultants, and project purchasers from design coordination through production inspection and export delivery.',
      advantagesTitle: 'Source Factory Capability For Complex Facade Panels',
      heroCaption:
        'Factory-direct aluminum facade panels for commercial complexes, airports, landmarks, and custom building envelopes.',
      heroKicker: 'IVYBM Building Materials',
      heroSubtitle:
        'Source factory for double-curved, single-curved, and custom facade aluminum panel solutions.',
      heroTitle: 'Professional Curved Aluminum Panel Manufacturer',
      productsSubtitle: 'Core facade panel systems for complex overseas construction projects.',
      productsTitle: 'Product Categories',
      projectsSubtitle:
        'Representative applications across commercial, airport, landmark, and public building envelopes.',
      projectsTitle: 'Featured Projects',
      values: [
        ['Source Factory Direct', 'Direct manufacturing support for drawings, samples, and project-specific production control.'],
        ['Custom Fabrication', 'Double-curved, single-curved, perforated, folded, and special-shaped panels.'],
        ['Global Delivery', 'Export packing, logistics coordination, and documentation support for overseas projects.'],
        ['Quality Certified', 'Inspection-ready control for material, dimensions, color, coating, packing, VMU, and PMU samples.'],
      ],
    },
    navigation: {
      about: 'About Us',
      contact: 'Contact',
      home: 'Home',
      news: 'News',
      products: 'Products',
      projects: 'Projects',
    },
    pages: {
      aboutSubtitle: 'A source factory partner for curved and custom aluminum panel projects.',
      contactSubtitle: 'Contact our project team for technical and quotation support.',
      newsSubtitle: 'Industry notes, technical articles, and company updates for facade procurement.',
      productsSubtitle: 'Evaluate custom aluminum facade panel systems for your project.',
      projectsSubtitle: 'Project references showing factory capability and engineering coordination.',
    },
    tabs: {
      all: 'All',
      allProjects: 'All Projects',
      company: 'Company News',
      industry: 'Industry Trends',
      products: 'Products',
      projects: 'Projects',
      technical: 'Technical Articles',
    },
  },
  ar: {
    accessibility: {
      language: 'اللغة',
      mainNavigation: 'التنقل الرئيسي',
      menu: 'القائمة',
      mobileNavigation: 'التنقل عبر الهاتف',
      nextSlide: 'الشريحة التالية',
      previousSlide: 'الشريحة السابقة',
      whatsapp: 'واتساب',
    },
    about: {
      body:
        'تدعم IVYBM فرق شراء الواجهات الخارجية من خلال تنسيق الرسومات وفحص الأبعاد والتشطيبات والتعبئة ووثائق التصدير.',
      kicker: 'نبذة عن المصنع',
      processDescription:
        'يمكن تنسيق شهادات المواد وفحص الأبعاد والطلاء واعتماد اللون ومراجعة التجميع التجريبي وحماية التعبئة ووثائق الشحن لكل مشروع.',
      processTitle: 'رقابة إنتاج جاهزة للفحص',
      stats: [
        ['+10', 'سنوات من خبرة توريد الواجهات'],
        ['+120', 'دفعة مشاريع تم دعمها'],
        ['+20', 'سوق تصدير تمت خدمته'],
      ],
      title: 'مصمم لمشتريات مشاريع الواجهات الخارجية',
    },
    actions: {
      allProjects: 'كل المشاريع',
      contact: 'اتصل بنا',
      learnMore: 'اعرف المزيد',
      quote: 'اطلب عرض سعر',
      readMore: 'اقرأ المزيد',
      viewCase: 'عرض الحالة',
    },
    chat: {
      assistantAvailable: 'مساعد مشروع بالذكاء الاصطناعي',
      close: 'إغلاق المحادثة',
      greeting: 'مرحبًا — يمكنني المساعدة بمعلومات المنتجات وربطك بفريق المشروع لدينا.',
      handoffPending: 'تمت مشاركة طلبك مع فريق المشروع. سينضم إليك أحد المختصين قريبًا.',
      humanActive: 'انضم أحد مختصي المشروع إلى هذه المحادثة.',
      launcher: 'اسأل مساعد المشروع',
      loading: 'جارٍ إعداد محادثة آمنة…',
      newConversation: 'بدء محادثة جديدة',
      rateLimited: 'يرجى الانتظار لحظة قبل المحاولة مرة أخرى.',
      requestHuman: 'التحدث مع مختص',
      resolved: 'تمت معالجة هذه المحادثة. يرجى إرسال استفسار جديد إذا احتجت إلى مزيد من المساعدة.',
      retry: 'إعادة المحاولة',
      retryMessage: 'إعادة إرسال الرسالة',
      send: 'إرسال',
      sending: 'جارٍ الإرسال…',
      sources: 'مصادر مراجَعة',
      title: 'مساعد المشروع',
      unavailable: 'خدمة المحادثة غير متاحة مؤقتًا. يرجى المحاولة مرة أخرى.',
      inputPlaceholder: 'اسأل عن الألواح أو مشروعك…',
    },
    contact: {
      company: 'الشركة',
      country: 'الدولة *',
      countryOptions: [
        ['United Arab Emirates', 'الإمارات العربية المتحدة'],
        ['Saudi Arabia', 'المملكة العربية السعودية'],
        ['Qatar', 'قطر'],
        ['Oman', 'عُمان'],
        ['Kuwait', 'الكويت'],
        ['United States', 'الولايات المتحدة'],
        ['Australia', 'أستراليا'],
        ['Other', 'أخرى'],
      ],
      email: 'البريد الإلكتروني *',
      emailCard: 'البريد الإلكتروني',
      invalidField: 'يرجى إدخال قيمة صحيحة.',
      interest: 'المنتج المطلوب',
      invalidEmail: 'يرجى إدخال بريد إلكتروني صحيح.',
      invalidPhone: 'يرجى إدخال رقم هاتف دولي صحيح.',
      location: 'موقع المصنع',
      message: 'الرسالة *',
      messagePlaceholder: 'اذكر حالة الرسومات والكمية والتشطيب والجدول الزمني وموقع المشروع.',
      name: 'الاسم *',
      noScript: 'يعمل هذا النموذج بأمان بدون JavaScript وسيفتح صفحة تأكيد.',
      phone: 'الهاتف',
      productOptions: [
        ['double-curved-aluminum-panel', 'ألواح ألمنيوم مزدوجة الانحناء'],
        ['single-curved-aluminum-panel', 'ألواح ألمنيوم أحادية الانحناء'],
        ['solid-aluminum-panel', 'ألواح ألمنيوم للواجهات القياسية'],
        ['other', 'أخرى'],
      ],
      required: 'هذا الحقل مطلوب.',
      received: 'تم استلام الاستفسار.',
      reference: 'الرقم المرجعي',
      rateLimited: 'تم إرسال عدد كبير من الطلبات. يرجى الانتظار قبل المحاولة.',
      reviewFields: 'يرجى مراجعة الحقول المحددة.',
      send: 'إرسال الاستفسار',
      sending: 'جارٍ الإرسال…',
      subtitle:
        'شارك الرسومات والكميات ومتطلبات التشطيب أو جدول التسليم المستهدف. سيرد فريقنا خلال 24 ساعة.',
      title: 'أرسل استفسار مشروعك',
      tooLong: 'هذه القيمة طويلة جدًا.',
      unavailable: 'خدمة الاستفسارات غير متاحة مؤقتًا. يرجى إعادة المحاولة بنفس البيانات.',
      workingHours: 'ساعات العمل',
      workingHoursValue: 'الاثنين - السبت\n09:00 - 18:00 بتوقيت الصين',
    },
    footer: {
      contact: 'اتصل بنا',
      quickLinks: 'روابط سريعة',
      rights: 'جميع الحقوق محفوظة.',
    },
    home: {
      advantagesKicker: 'مزايا المصنع',
      advantagesSubtitle:
        'تدعم IVYBM المقاولين والاستشاريين ومشتري المشاريع من تنسيق التصميم حتى فحص الإنتاج والتسليم للتصدير.',
      advantagesTitle: 'قدرة مصنع مصدر لألواح الواجهات المعقدة',
      heroCaption:
        'ألواح ألمنيوم مباشرة من المصنع للمجمعات التجارية والمطارات والمباني المميزة والواجهات الخاصة.',
      heroKicker: 'IVYBM لمواد البناء',
      heroSubtitle:
        'مصدر مباشر لألواح الواجهات مزدوجة الانحناء وأحادية الانحناء والحلول المخصصة.',
      heroTitle: 'مصنع محترف لألواح الألمنيوم المنحنية',
      productsSubtitle: 'أنظمة ألواح واجهات أساسية لمشاريع البناء العالمية المعقدة.',
      productsTitle: 'فئات المنتجات',
      projectsSubtitle: 'تطبيقات مختارة للمباني التجارية والمطارات والمعالم والمباني العامة.',
      projectsTitle: 'مشاريع مختارة',
      values: [
        ['توريد مباشر من المصنع', 'دعم مباشر للتصنيع والرسومات والعينات وضبط الإنتاج حسب المشروع.'],
        ['تصنيع مخصص', 'ألواح مزدوجة وأحادية الانحناء ومثقبة ومطوية وأشكال خاصة.'],
        ['تسليم عالمي', 'تعبئة للتصدير وتنسيق الخدمات اللوجستية ووثائق المشاريع الخارجية.'],
        ['رقابة الجودة', 'فحص المواد والأبعاد والألوان والطلاء والتعبئة وعينات VMU وPMU.'],
      ],
    },
    navigation: {
      about: 'من نحن',
      contact: 'اتصل بنا',
      home: 'الرئيسية',
      news: 'الأخبار',
      products: 'المنتجات',
      projects: 'المشاريع',
    },
    pages: {
      aboutSubtitle: 'شريك مصنع مصدر لمشاريع ألواح الألمنيوم المنحنية والمخصصة.',
      contactSubtitle: 'تواصل مع فريق المشروع للحصول على الدعم الفني وعرض السعر.',
      newsSubtitle: 'ملاحظات فنية وأخبار الشركة لمشتريات واجهات الألمنيوم.',
      productsSubtitle: 'قيّم أنظمة ألواح الواجهات المخصصة لمشروعك.',
      projectsSubtitle: 'مراجع مشاريع توضح قدرة المصنع والتنسيق الهندسي.',
    },
    tabs: {
      all: 'الكل',
      allProjects: 'كل المشاريع',
      company: 'أخبار الشركة',
      industry: 'اتجاهات الصناعة',
      products: 'المنتجات',
      projects: 'المشاريع',
      technical: 'مقالات فنية',
    },
  },
} as const

export const getWebsiteCopy = (locale: Locale) => WEBSITE_COPY[locale]

export const getPostCategoryLabel = (locale: Locale, category: PostCategory): string => {
  const copy = getWebsiteCopy(locale)

  return {
    company: copy.tabs.company,
    industry: copy.tabs.industry,
    products: copy.tabs.products,
    projects: copy.tabs.projects,
  }[category]
}
