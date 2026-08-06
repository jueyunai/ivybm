import type { Locale } from './i18n'

export const LEGAL_PATHS = ['/privacy', '/terms', '/data-deletion'] as const
export type LegalPath = (typeof LEGAL_PATHS)[number]
export type LegalDocumentType = 'data-deletion' | 'privacy' | 'terms'

export type LegalSection = {
  items?: string[]
  paragraphs: string[]
  steps?: string[]
  title: string
}

export type LegalDocument = {
  contactLabel: string
  description: string
  effectiveDate: string
  effectiveDateLabel: string
  sections: LegalSection[]
  title: string
}

const EFFECTIVE_DATE = '2026-07-31'

const DOCUMENTS: Record<Locale, Record<LegalDocumentType, LegalDocument>> = {
  en: {
    privacy: {
      contactLabel: 'Privacy contact',
      description:
        'How IVY Building Materials collects, uses, protects, and deletes website inquiry, chat, Facebook, and Instagram data.',
      effectiveDate: EFFECTIVE_DATE,
      effectiveDateLabel: 'Effective date',
      sections: [
        {
          title: 'Who we are',
          paragraphs: [
            'IVY Building Materials (IVYBM, “we”, “us”) supplies architectural aluminum facade products and operates this website and its business communication channels. This notice applies to website visitors, inquiry contacts, and people who communicate with our connected Facebook Pages or Instagram professional accounts.',
          ],
        },
        {
          title: 'Information we collect',
          paragraphs: [
            'We collect only information reasonably needed to answer inquiries, coordinate projects, operate customer support, secure the service, and maintain business records.',
          ],
          items: [
            'Contact and project information you submit, such as name, company, email, phone, country, drawings, specifications, quantities, and message content.',
            'Website and security information such as request time, browser or device information, IP-derived security signals, session identifiers, and error records.',
            'Messages and identifiers provided through connected Facebook and Instagram business features, including the Page or professional account, sender-scoped identifier, message text, attachments, timestamps, and delivery events made available by Meta.',
            'Operational records such as consent or authorization status, assigned operator, response history, audit events, and platform permission status.',
          ],
        },
        {
          title: 'How we use information',
          paragraphs: [
            'We use information to respond to requests, prepare quotations or technical follow-up, route conversations to authorized staff, prevent abuse, troubleshoot integrations, comply with platform rules, and protect our legal rights. Automated assistance may draft or retrieve reviewed information, but high-risk commercial, legal, delivery, certification, and pricing decisions are referred to authorized staff.',
            'We do not sell personal information. We do not use connected Facebook or Instagram data for unrelated advertising profiles.',
          ],
        },
        {
          title: 'Sharing, international processing, and security',
          paragraphs: [
            'Information may be processed by authorized IVYBM staff and service providers that host the website, database, communications, monitoring, or approved AI services. Providers receive only the access needed for their function and are subject to contractual or platform safeguards where applicable.',
            'Because our customers and systems may be located in different countries, information may be processed outside your country. We use reasonable technical and organizational safeguards, including access control, encrypted credentials, audit records, and data minimization. No internet service can guarantee absolute security.',
          ],
        },
        {
          title: 'Retention, choices, and your rights',
          paragraphs: [
            'We retain inquiry and conversation information only for as long as reasonably necessary for the project, customer support, security, dispute handling, legal obligations, and backup rotation. Platform access tokens are removed when an account is disconnected or the authorization is revoked.',
            'Depending on applicable law, you may request access, correction, deletion, restriction, or objection. You may also revoke IVYBM from Facebook or Instagram settings. To request deletion, follow our Data Deletion Instructions and do not send passwords, access tokens, or identity documents through an unsecured channel.',
          ],
        },
        {
          title: 'Updates and contact',
          paragraphs: [
            'We may update this notice when our services, platform permissions, or legal obligations change. The effective date above identifies the current version. Contact us through the email shown below or the website contact page with questions about this notice.',
          ],
        },
      ],
      title: 'Privacy Policy',
    },
    terms: {
      contactLabel: 'Terms contact',
      description:
        'Terms governing use of the IVY Building Materials website, inquiry tools, project information, and connected business communication services.',
      effectiveDate: EFFECTIVE_DATE,
      effectiveDateLabel: 'Effective date',
      sections: [
        {
          title: 'Acceptance and business purpose',
          paragraphs: [
            'By using this website or its inquiry and business messaging features, you agree to these Terms. The service provides general product information, project inquiry intake, customer support, and communication with IVYBM. If you do not agree, do not use the service.',
          ],
        },
        {
          title: 'No automatic quotation or engineering approval',
          paragraphs: [
            'Website content, chat responses, drawings, dimensions, product examples, delivery estimates, certificates, and technical notes are preliminary information only. Final specifications, performance, pricing, payment, production, delivery, warranty, compliance, and acceptance are governed by signed quotations, approved drawings or samples, current supporting documents, and the applicable contract.',
          ],
        },
        {
          title: 'Permitted use',
          paragraphs: ['You may use the service for legitimate business inquiries and project evaluation.'],
          items: [
            'Do not submit unlawful, deceptive, abusive, infringing, malicious, or confidential third-party material without authority.',
            'Do not probe, disrupt, scrape, overload, bypass access controls, or attempt to obtain credentials or data belonging to another person or business.',
            'Do not represent automated or preliminary content as a binding commitment from IVYBM.',
          ],
        },
        {
          title: 'Intellectual property and submitted materials',
          paragraphs: [
            'The website design, text, images, marks, and original materials are owned by IVYBM or used with permission. You may not reproduce or redistribute them beyond reasonable project evaluation without authorization.',
            'You retain rights in materials you submit. You grant us permission to process and share them with authorized staff and service providers only as needed to respond to your inquiry, evaluate the project, provide requested services, and maintain security and records.',
          ],
        },
        {
          title: 'Availability and third-party platforms',
          paragraphs: [
            'The service may depend on hosting providers, Meta, Facebook, Instagram, LinkedIn, and other third-party systems. Features may be delayed, limited, suspended, or changed by those providers. We may restrict access to protect users, assets, or the service.',
          ],
        },
        {
          title: 'Liability, changes, and contact',
          paragraphs: [
            'To the extent permitted by applicable law, the service is provided on an “as available” basis. Nothing in these Terms excludes rights or liability that cannot legally be excluded. We may update these Terms and will identify the current version by its effective date. Contact us through the email below or the website contact page with questions.',
          ],
        },
      ],
      title: 'Terms of Service',
    },
    'data-deletion': {
      contactLabel: 'Data deletion contact',
      description:
        'Instructions for requesting deletion of personal information and Facebook or Instagram business messaging data held by IVY Building Materials.',
      effectiveDate: EFFECTIVE_DATE,
      effectiveDateLabel: 'Effective date',
      sections: [
        {
          title: 'Revoke platform access first',
          paragraphs: [
            'You may remove IVYBM or the connected application from your Facebook or Instagram business integrations and permissions. Revocation stops new authorized access but may not delete information already received for legitimate business, security, or legal purposes.',
          ],
        },
        {
          title: 'Submit a deletion request',
          paragraphs: [
            'Send a request to the contact email shown below or through our website contact page. Use the subject “Social Data Deletion Request” so the request reaches the appropriate team.',
          ],
          steps: [
            'State whether the request relates to the website, Facebook, Instagram, or more than one channel.',
            'Provide the name and email or business contact you used with us, plus the relevant Facebook Page or Instagram username when applicable.',
            'Describe the conversations, inquiry, or date range you want us to locate. Do not include a password, access token, cookie, recovery code, or unnecessary identity document.',
          ],
        },
        {
          title: 'Verification',
          paragraphs: [
            'We may ask for limited information to confirm that the requester is the person concerned or is authorized to act for the relevant business asset. We will not ask for a Facebook or Instagram password or access token.',
          ],
        },
        {
          title: 'What we delete',
          paragraphs: [
            'After a valid request, we will delete or de-identify personal information and connected social message data that we are not required or permitted to retain. Disconnecting a managed platform account also removes its stored access credentials from active use.',
            'Some records may be retained where reasonably necessary for security, fraud prevention, transaction or project records, dispute handling, legal obligations, or limited backup rotation. We will explain an applicable limitation when required.',
          ],
        },
        {
          title: 'Confirmation and questions',
          paragraphs: [
            'We will acknowledge a valid request and provide confirmation when processing is complete, subject to applicable law and reasonable verification. Contact us through the address below if you need help identifying the relevant account or channel.',
          ],
        },
      ],
      title: 'Data Deletion Instructions',
    },
  },
  ar: {
    privacy: {
      contactLabel: 'جهة الاتصال بشأن الخصوصية',
      description:
        'كيفية جمع شركة IVY لمواد البناء لبيانات استفسارات الموقع والدردشة وفيسبوك وإنستغرام واستخدامها وحمايتها وحذفها.',
      effectiveDate: EFFECTIVE_DATE,
      effectiveDateLabel: 'تاريخ السريان',
      sections: [
        {
          title: 'من نحن',
          paragraphs: [
            'تورد شركة IVY لمواد البناء (IVYBM أو «نحن») منتجات ألمنيوم الواجهات المعمارية وتشغل هذا الموقع وقنوات التواصل التجاري المرتبطة به. ينطبق هذا الإشعار على زوار الموقع وأصحاب الاستفسارات ومن يتواصلون مع صفحات فيسبوك أو حسابات إنستغرام المهنية المرتبطة بنا.',
          ],
        },
        {
          title: 'المعلومات التي نجمعها',
          paragraphs: [
            'نجمع فقط المعلومات اللازمة بصورة معقولة للرد على الاستفسارات وتنسيق المشاريع وتشغيل دعم العملاء وتأمين الخدمة وحفظ سجلات الأعمال.',
          ],
          items: [
            'بيانات الاتصال والمشروع التي تقدمها، مثل الاسم والشركة والبريد والهاتف والدولة والرسومات والمواصفات والكميات ومحتوى الرسالة.',
            'بيانات الموقع والأمان، مثل وقت الطلب ومعلومات المتصفح أو الجهاز وإشارات الأمان المشتقة من عنوان IP ومعرفات الجلسة وسجلات الأخطاء.',
            'الرسائل والمعرفات التي توفرها ميزات فيسبوك وإنستغرام التجارية، بما في ذلك الصفحة أو الحساب المهني ومعرف المرسل ومحتوى الرسالة والمرفقات والطوابع الزمنية وأحداث التسليم التي تتيحها Meta.',
            'السجلات التشغيلية، مثل حالة الموافقة أو التفويض والموظف المسؤول وسجل الردود وأحداث التدقيق وحالة أذونات المنصة.',
          ],
        },
        {
          title: 'كيفية استخدام المعلومات',
          paragraphs: [
            'نستخدم المعلومات للرد على الطلبات وإعداد المتابعة الفنية أو عروض الأسعار وتوجيه المحادثات إلى الموظفين المخولين ومنع إساءة الاستخدام ومعالجة أعطال التكامل والامتثال لقواعد المنصات وحماية حقوقنا القانونية. قد تساعد الأدوات الآلية في إعداد مسودات أو استرجاع معلومات مراجعة، بينما تحال القرارات التجارية أو القانونية أو قرارات السعر والتسليم والشهادات إلى الموظفين المخولين.',
            'لا نبيع المعلومات الشخصية ولا نستخدم بيانات فيسبوك أو إنستغرام المرتبطة لإنشاء ملفات إعلانية غير ذات صلة.',
          ],
        },
        {
          title: 'المشاركة والمعالجة الدولية والأمان',
          paragraphs: [
            'قد يعالج المعلومات موظفو IVYBM المخولون ومقدمو خدمات الاستضافة وقواعد البيانات والاتصالات والمراقبة وخدمات الذكاء الاصطناعي المعتمدة. يحصل كل مقدم على الحد اللازم من الوصول لوظيفته وتطبق عليه الضمانات التعاقدية أو ضمانات المنصة عند الاقتضاء.',
            'قد تعالج المعلومات خارج دولتك لأن عملاءنا وأنظمتنا موزعون بين دول مختلفة. نستخدم ضمانات تقنية وتنظيمية معقولة، تشمل التحكم في الوصول وتشفير بيانات الاعتماد وسجلات التدقيق وتقليل البيانات. لا يمكن لأي خدمة عبر الإنترنت ضمان الأمان المطلق.',
          ],
        },
        {
          title: 'الاحتفاظ والخيارات وحقوقك',
          paragraphs: [
            'نحتفظ ببيانات الاستفسارات والمحادثات فقط للمدة اللازمة بصورة معقولة للمشروع ودعم العملاء والأمان وتسوية النزاعات والالتزامات القانونية ودورة النسخ الاحتياطي. تزال رموز وصول المنصات عند فصل الحساب أو إلغاء التفويض.',
            'بحسب القانون المطبق، يمكنك طلب الوصول أو التصحيح أو الحذف أو التقييد أو الاعتراض. ويمكنك كذلك إلغاء وصول IVYBM من إعدادات فيسبوك أو إنستغرام. لطلب الحذف اتبع تعليمات حذف البيانات ولا ترسل كلمات مرور أو رموز وصول أو وثائق هوية عبر قناة غير آمنة.',
          ],
        },
        {
          title: 'التحديثات والتواصل',
          paragraphs: [
            'قد نحدث هذا الإشعار عند تغير خدماتنا أو أذونات المنصات أو التزاماتنا القانونية. يحدد تاريخ السريان أعلاه النسخة الحالية. تواصل معنا عبر البريد المبين أدناه أو صفحة الاتصال في الموقع لأي سؤال.',
          ],
        },
      ],
      title: 'سياسة الخصوصية',
    },
    terms: {
      contactLabel: 'جهة الاتصال بشأن الشروط',
      description:
        'الشروط المنظمة لاستخدام موقع IVY لمواد البناء وأدوات الاستفسار ومعلومات المشاريع وخدمات التواصل التجاري المرتبطة.',
      effectiveDate: EFFECTIVE_DATE,
      effectiveDateLabel: 'تاريخ السريان',
      sections: [
        {
          title: 'القبول والغرض التجاري',
          paragraphs: [
            'باستخدام هذا الموقع أو ميزات الاستفسار والمراسلة التجارية، فإنك توافق على هذه الشروط. توفر الخدمة معلومات عامة عن المنتجات واستقبال استفسارات المشاريع ودعم العملاء والتواصل مع IVYBM. إذا لم توافق، فلا تستخدم الخدمة.',
          ],
        },
        {
          title: 'لا يوجد عرض سعر أو اعتماد هندسي تلقائي',
          paragraphs: [
            'محتوى الموقع وردود الدردشة والرسومات والأبعاد وأمثلة المنتجات وتقديرات التسليم والشهادات والملاحظات الفنية معلومات أولية فقط. تخضع المواصفات والأداء والسعر والدفع والإنتاج والتسليم والضمان والامتثال والقبول النهائية لعروض الأسعار الموقعة والرسومات أو العينات المعتمدة والمستندات الحالية والعقد المنطبق.',
          ],
        },
        {
          title: 'الاستخدام المسموح',
          paragraphs: ['يجوز استخدام الخدمة للاستفسارات التجارية المشروعة وتقييم المشاريع.'],
          items: [
            'لا تقدم مواد غير قانونية أو خادعة أو مسيئة أو منتهكة أو ضارة أو مواد سرية تخص الغير دون صلاحية.',
            'لا تختبر الخدمة أو تعطلها أو تجمعها آليًا أو تفرط في تحميلها أو تتجاوز ضوابط الوصول أو تحاول الحصول على بيانات اعتماد أو بيانات تخص شخصًا أو شركة أخرى.',
            'لا تقدم المحتوى الآلي أو الأولي على أنه التزام ملزم من IVYBM.',
          ],
        },
        {
          title: 'الملكية الفكرية والمواد المقدمة',
          paragraphs: [
            'تصميم الموقع ونصوصه وصوره وعلاماته ومواده الأصلية مملوكة لـ IVYBM أو مستخدمة بإذن. لا يجوز إعادة إنتاجها أو توزيعها خارج نطاق تقييم المشروع المعقول دون تصريح.',
            'تحتفظ بحقوقك في المواد التي تقدمها، وتمنحنا إذنًا لمعالجتها ومشاركتها مع الموظفين ومقدمي الخدمات المخولين بالقدر اللازم للرد على استفسارك وتقييم المشروع وتقديم الخدمة المطلوبة والحفاظ على الأمان والسجلات.',
          ],
        },
        {
          title: 'التوفر والمنصات الخارجية',
          paragraphs: [
            'قد تعتمد الخدمة على مزودي الاستضافة وMeta وفيسبوك وإنستغرام وLinkedIn وأنظمة خارجية أخرى. وقد تتأخر الميزات أو تقيد أو تعلق أو تتغير بقرار تلك الجهات. ويجوز لنا تقييد الوصول لحماية المستخدمين أو الأصول أو الخدمة.',
          ],
        },
        {
          title: 'المسؤولية والتغييرات والتواصل',
          paragraphs: [
            'في الحدود التي يسمح بها القانون، تقدم الخدمة حسب توفرها. ولا تستبعد هذه الشروط أي حقوق أو مسؤوليات لا يجوز استبعادها قانونًا. قد نحدث الشروط وسنحدد النسخة الحالية بتاريخ السريان. تواصل معنا عبر البريد أدناه أو صفحة الاتصال لأي سؤال.',
          ],
        },
      ],
      title: 'شروط الخدمة',
    },
    'data-deletion': {
      contactLabel: 'جهة الاتصال لحذف البيانات',
      description:
        'تعليمات طلب حذف المعلومات الشخصية وبيانات مراسلات فيسبوك أو إنستغرام التجارية المحتفظ بها لدى IVY لمواد البناء.',
      effectiveDate: EFFECTIVE_DATE,
      effectiveDateLabel: 'تاريخ السريان',
      sections: [
        {
          title: 'إلغاء وصول المنصة أولًا',
          paragraphs: [
            'يمكنك إزالة IVYBM أو التطبيق المرتبط من تكاملات وأذونات الأعمال في فيسبوك أو إنستغرام. يوقف الإلغاء الوصول المصرح به مستقبلًا، لكنه قد لا يحذف معلومات سبق استلامها لأغراض تجارية أو أمنية أو قانونية مشروعة.',
          ],
        },
        {
          title: 'إرسال طلب الحذف',
          paragraphs: [
            'أرسل الطلب إلى البريد المبين أدناه أو عبر صفحة الاتصال في موقعنا، واستخدم عنوان الرسالة “Social Data Deletion Request” حتى يصل إلى الفريق المختص.',
          ],
          steps: [
            'حدد ما إذا كان الطلب يتعلق بالموقع أو فيسبوك أو إنستغرام أو أكثر من قناة.',
            'قدم الاسم والبريد أو جهة الاتصال التجارية المستخدمة معنا، واسم صفحة فيسبوك أو حساب إنستغرام عند الاقتضاء.',
            'صف المحادثة أو الاستفسار أو النطاق الزمني المطلوب البحث عنه. لا ترسل كلمة مرور أو access token أو ملف تعريف ارتباط أو رمز استرداد أو وثيقة هوية غير ضرورية.',
          ],
        },
        {
          title: 'التحقق',
          paragraphs: [
            'قد نطلب معلومات محدودة للتأكد من أن مقدم الطلب هو الشخص المعني أو مخول بالتصرف نيابة عن أصل العمل ذي الصلة. لن نطلب كلمة مرور فيسبوك أو إنستغرام أو رمز وصول.',
          ],
        },
        {
          title: 'ما الذي نحذفه',
          paragraphs: [
            'بعد التحقق من الطلب، نحذف أو نزيل هوية المعلومات الشخصية وبيانات الرسائل الاجتماعية المرتبطة التي لا يلزمنا أو يسمح لنا الاحتفاظ بها. كما يؤدي فصل حساب منصة مُدار إلى إزالة بيانات اعتماد الوصول المخزنة من الاستخدام النشط.',
            'قد نحتفظ ببعض السجلات عند الضرورة المعقولة للأمان ومنع الاحتيال وسجلات المعاملات أو المشاريع وتسوية النزاعات والالتزامات القانونية ودورة نسخ احتياطي محدودة، وسنوضح القيد المطبق عند اللزوم.',
          ],
        },
        {
          title: 'التأكيد والأسئلة',
          paragraphs: [
            'سنؤكد استلام الطلب الصحيح ونرسل تأكيدًا عند اكتمال المعالجة، وفق القانون المطبق والتحقق المعقول. تواصل معنا عبر العنوان أدناه إذا احتجت للمساعدة في تحديد الحساب أو القناة.',
          ],
        },
      ],
      title: 'تعليمات حذف البيانات',
    },
  },
}

export const getLegalDocument = (locale: Locale, type: LegalDocumentType): LegalDocument =>
  DOCUMENTS[locale][type]
