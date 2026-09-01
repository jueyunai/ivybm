import { getWebsiteCopy, type Locale } from '@/lib/i18n'

export type KnowledgeCategory =
  | 'materialComparison'
  | 'technicalGuide'
  | 'procurement'
  | 'qualityLogistics'

export const WEBSITE_V17_COPY = {
  en: {
    actions: {
      buildabilityReview: 'Request Buildability Review',
      uploadDrawing: 'Upload Drawing',
    },
    capabilities: {
      ctaButton: 'Request Buildability Review',
      ctaSubtitle:
        'Submit your architectural drawings, 3D surface files, or tender BOQ for direct source factory engineering and feasibility analysis.',
      ctaTitle: 'Have Complex Facade Drawings to Deepen?',
      items: [
        {
          description:
            'BIM coordination, Rhino/Grasshopper parametric modeling, structural calculations, expansion node deepening, and CNC fabrication unwrapping.',
          features: [
            'Rhino & Grasshopper parametric surface modeling',
            'Structural analysis & deflection coordination',
            'Expansion joint & substructure interface detailing',
            'Automated fabrication unfolding & node numbering',
          ],
          id: 'design-engineering',
          step: '01',
          title: 'Design Deepening & 3D Engineering',
        },
        {
          description:
            'Multi-axis CNC roll-bending, hyperbolic panel forming, robotic seamless welding, and automated 3-coat PVDF fluorocarbon coating.',
          features: [
            'Double-curved, spherical & variable-radius forming',
            'Seamless robotic argon-arc welding & grinding',
            'Automated PPG / AkzoNobel 3-coat PVDF finish',
            'Acoustic perforated & custom-embossed panels',
          ],
          id: 'complex-fabrication',
          step: '02',
          title: 'Complex Hyperbolic Fabrication',
        },
        {
          description:
            'Full-scale Visual Mock-up (VMU) and Performance Mock-up (PMU) pre-assembly, coordinate inspection, and coating adhesion verification.',
          features: [
            '1:1 VMU visual & PMU performance pre-assembly',
            '3D coordinate checking & geometric audit',
            'Rigorous dimensional tolerance & alignment check',
            'Dry film thickness & cross-hatch adhesion testing',
          ],
          id: 'mockup-qc',
          step: '03',
          title: '1:1 Mock-up & Precision Inspection',
        },
        {
          description:
            'Custom steel & fumigated wooden crate protection, container space optimization, Mill Test Certificates (MTC), and export compliance documentation.',
          features: [
            'Custom reinforced steel / fumigated timber crates',
            'Moisture-proof & anti-scratch protective wrapping',
            'Container payload & weight balance optimization',
            'Full export customs & inspection documentation',
          ],
          id: 'global-delivery',
          step: '04',
          title: 'Global Export Delivery & Packaging',
        },
      ],
      kicker: 'Factory Capabilities',
      stats: [
        ['Design Deepening', 'BIM & parametric coordination'],
        ['Complex Forming', 'Multi-axis CNC hyperbolic roll-bending'],
        ['Trial Assembly', '1:1 VMU & PMU inspection'],
        ['Global Delivery', 'Export packing and logistics coordination'],
      ],
      subtitle:
        'A complete 4-step engineering workflow from parametric design deepening to complex hyperbolic fabrication, 1:1 mock-up verification, and overseas export delivery.',
      title: 'Engineering & Manufacturing Capabilities',
    },
    contact: {
      send: 'Submit',
      sending: 'Submitting…',
      drawingStatus: 'Drawings / 3D Model Status',
      drawingStatusOptions: [
        ['ready', 'Drawings / 3D models available'],
        ['concept', 'Concept stage (No drawings yet)'],
      ] as Array<[string, string]>,
      estimatedQuantity: 'Estimated Quantity (m²)',
      inquiryIntent: 'Inquiry Type',
      inquiryIntentOptions: [
        ['standard_quote', 'Standard Quote / Price Check'],
        ['buildability_review', 'Buildability Review & Technical Deepening'],
      ] as Array<[string, string]>,
      optionalNote: 'Optional (recommended for faster RFQ)',
      projectStage: 'Project Stage',
      projectStageOptions: [
        ['concept', 'Concept / Schematic Design'],
        ['tender', 'Tender / Bidding Stage'],
        ['procurement', 'Procurement / PO Issued'],
        ['construction', 'Under Construction / Site Assembly'],
      ] as Array<[string, string]>,
      submitWithoutDrawings:
        'You can submit your project requirements now, with or without drawings.',
    },
    forProfessionals: {
      ctaButton: 'Upload Project Drawings',
      ctaSubtitle:
        'Upload your concept drawings, tender BOQ, or 3D geometry files for direct source factory engineering and commercial review.',
      ctaTitle: 'Ready for Engineering Feasibility Review?',
      kicker: 'For Professionals',
      roles: [
        {
          badge: 'Design & Geometry',
          description:
            'Transform complex parametric sketches and freeform curves into precise, inspectable aluminum facade panels without aesthetic compromise.',
          highlights: [
            'Parametric surface division & panelization optimization',
            'Visual joint coordination & reveal alignment',
            '1:1 VMU physical samples for architect & client approval',
            'Custom metallic, anodized & fluorocarbon finish confirmation',
          ],
          id: 'architects',
          target: 'For Architects & Designers',
          title: 'Architects & Facade Consultants',
        },
        {
          badge: 'Engineering & Site',
          description:
            'Direct factory shop drawing coordination, bracket interface engineering, and reliable staged delivery schedules.',
          highlights: [
            'Shop drawing & engineering calculation review',
            'Substructure & bracket interface coordination',
            'Batch coding & installation sequence labeling',
            'On-site installation tolerance guidance',
          ],
          id: 'contractors',
          target: 'For Facade Contractors',
          title: 'Curtain Wall & Facade Contractors',
        },
        {
          badge: 'Procurement & Cost',
          description:
            'Factory-direct BOQ pricing, transparent raw material certifications, packaging integrity, and export logistics.',
          highlights: [
            'Transparent BOQ cost breakdown & value engineering',
            'Mill Test Certificates (MTC) & coating test reports',
            'Export packing protection & sea/air logistics',
            'Strict adherence to project milestone dates',
          ],
          id: 'procurement',
          target: 'For Main Contractors & Procurement',
          title: 'Main Contractors & Procurement Heads',
        },
      ],
      subtitle:
        'Tailored engineering coordination, fabrication feasibility analysis, and commercial support for architects, facade contractors, and main contractors.',
      title: 'Engineering Support for Facade Professionals',
    },
    home: {
      coreCapabilitiesKicker: 'Factory Craftsmanship',
      coreCapabilitiesSubtitle:
        'Source factory capability for custom curved panels, architectural louvers, and perforated facade systems.',
      coreCapabilitiesTitle: 'High-Precision Complex Geometry Fabrication',
      craftsmanshipItems: [
        {
          description:
            'Single-curved, double-curved and custom-shaped aluminum panels for architectural facades.',
          id: 'double-curved',
          title: 'Double-Curved & Complex Geometry',
        },
        {
          description:
            'Aerodynamic shading louvers, decorative fins and custom extruded profiles.',
          id: 'louvers',
          title: 'Curved Louvers & Architectural Fins',
        },
        {
          description:
            'Custom laser-cut perforation, geometric screening and architectural lattice panels.',
          id: 'mashrabiya',
          title: 'Mashrabiya & Perforated Metal Panels',
        },
      ],
      ctaButton: 'Upload Drawing',
      ctaKicker: 'Start Your RFQ',
      ctaSubtitle:
        'Upload your architectural drawings, 3D geometry files, or tender BOQ for direct source factory buildability review.',
      ctaTitle: 'Ready for a Buildability Review of Your Facade?',
      exploreCapabilities: 'Explore Capabilities',
      howIvySupportsKicker: 'Engineering Workflow',
      howIvySupportsSubtitle:
        'A streamlined 4-step engineering model from design deepening to precision fabrication, mock-up testing, and export delivery.',
      howIvySupportsTitle: 'How IVY Supports Your Facade Project',
      professionalsBody:
        'From parametric modeling and mock-up verification to site delivery batches and BOQ optimization, we provide direct engineering coordination tailored to each project stakeholder.',
      professionalsCta: 'Explore Professional Solutions',
      professionalsKicker: 'Tailored Solutions',
      professionalsSubtitle:
        'Dedicated technical coordination and commercial deliverables for architects, facade contractors, and procurement heads.',
      professionalsTitle: 'Engineered for Project Decision Makers',
      professionalSummaries: [
        {
          description:
            'Geometry optimization, parametric surface rationalization, and physical VMU sample support.',
          id: 'architects',
          title: 'Architects & Consultants',
        },
        {
          description:
            'Shop drawing coordination, bracket interface engineering, and staged site delivery schedules.',
          id: 'contractors',
          title: 'Facade Contractors',
        },
        {
          description:
            'Factory-direct BOQ pricing, transparent raw material certifications, and export logistics.',
          id: 'procurement',
          title: 'General Contractors & Procurement',
        },
      ],
      supportItems: [
        {
          description:
            'Geometry review, panelization, shop drawings and buildability input.',
          id: 'design-engineering',
          step: '01',
          title: 'Design & Engineering',
        },
        {
          description:
            'Flat, curved, perforated and free-form architectural aluminum.',
          id: 'complex-fabrication',
          step: '02',
          title: 'Complex Fabrication',
        },
        {
          description:
            'Representative samples, dimensional checks, finish review and pre-shipment inspection.',
          id: 'mockup-qc',
          step: '03',
          title: 'Mock-up & QC',
        },
        {
          description:
            'Panel numbering, export packing, container planning and shipment coordination.',
          id: 'global-delivery',
          step: '04',
          title: 'Global Delivery',
        },
      ],
      utilityLeft: 'Architectural aluminum for complex facade projects',
      utilityRight: 'Engineering · Fabrication · QC · Global Delivery',
    },
    knowledge: {
      allCategories: 'All Topics',
      backToKnowledge: 'Back to Knowledge Base',
      categories: {
        materialComparison: 'Material Comparison',
        procurement: 'Procurement & BOQ',
        qualityLogistics: 'Quality & Logistics',
        technicalGuide: 'Technical Guide',
      },
      consultButton: 'Upload Drawing for Review',
      consultSubtitle:
        'Consult our facade engineering team for material specification and buildability evaluation.',
      consultTitle: 'Need Technical Advice for Your Project?',
      kicker: 'Knowledge Base',
      noArticles: 'No technical articles found in this category.',
      readTime: '{min} min read',
      relatedTitle: 'Related Technical Articles',
      subtitle:
        'Engineering articles, material comparisons, fabrication standards, and procurement guides for overseas architectural envelopes.',
      title: 'Technical Facade Knowledge Base',
    },
    navigation: {
      about: 'About',
      capabilities: 'Capabilities',
      contact: 'Contact',
      forProfessionals: 'For Professionals',
      home: 'Home',
      knowledge: 'Knowledge',
      news: 'News',
      products: 'Products',
      projects: 'Projects',
    },
    pages: {
      capabilitiesSubtitle:
        'Source factory engineering, parametric deepening, complex fabrication, 1:1 mock-up, and export delivery.',
      forProfessionalsSubtitle:
        'Engineering coordination and procurement support tailored for architects, facade contractors, and main contractors.',
      knowledgeSubtitle:
        'Technical guides, material comparisons, procurement standards, and facade engineering insights.',
    },
  },
  ar: {
    actions: {
      buildabilityReview: 'طلب مراجعة قابلية التصنيع',
      uploadDrawing: 'رفع المخططات',
    },
    capabilities: {
      ctaButton: 'طلب مراجعة قابلية التصنيع',
      ctaSubtitle:
        'أرسل رسوماتك المعمارية أو ملفات الأسطح ثلاثية الأبعاد أو جداول الكميات للحصول على تحليل هندسي مباشر من المصنع.',
      ctaTitle: 'هل لديك رسومات واجهات معقدة تحتاج إلى تعميق هندسي؟',
      items: [
        {
          description:
            'تكامل BIM، نمذجة بارامترية عبر Rhino/Grasshopper، حسابات إنشائية، تعميق فواصل التمدد والتثبيت، وفرد التصنيع المؤتمت.',
          features: [
            'نمذجة أسطح بارامترية عبر Rhino و Grasshopper',
            'تحليل الإجهاد الإنشائي ومقاومة الرياح',
            'تفصيل فواصل التمدد وواجهات الهيكل الثانوي',
            'فرد ألواح التصنيع وترقيم العقد تلقائيًا',
          ],
          id: 'design-engineering',
          step: '01',
          title: 'تعميق التصميم والنمذجة ثلاثية الأبعاد',
        },
        {
          description:
            'درفلة CNC متعددة المحاور، تشكيل الألواح مزدوجة الانحناء، لحام أرجون آلي غير ملحوم، وخطوط طلاء PVDF فلوروكربوني آلية.',
          features: [
            'تشكيل ألواح مزدوجة الانحناء وكروية ومتغيرة القطر',
            'لحام أرجون آلي غير ملحوم وتشطيب دقيق',
            'طلاء PVDF آلي ثلاثي الطبقات من PPG / AkzoNobel',
            'ألواح مثقبة صوتية وألواح بنقوش هندسية مخصصة',
          ],
          id: 'complex-fabrication',
          step: '02',
          title: 'التصنيع المعقد للألواح المنحنية',
        },
        {
          description:
            'تجميع تجريبي مسبق لعينات VMU البصرية واختبارات PMU للأداء، تدقيق الإحداثيات الهندسية، وفحص التصاق الطلاء.',
          features: [
            'تجميع تجريبي مسبق لعينات 1:1 VMU و PMU',
            'تدقيق إحداثيات الأبعاد والتحقق الهندسي',
            'فحص دقيق لتفاوت الأبعاد ومحاذاة المفاصل',
            'فحص سماكة طبقة الطلاء واختبار الالتصاق الشبكي',
          ],
          id: 'mockup-qc',
          step: '03',
          title: 'نماذج 1:1 وفحص دقيق للجودة',
        },
        {
          description:
            'حماية بصناديق فولاذية وخشبية معقمة مخصصة، تحسين رص الحاويات، شهادات فحص المصنع (MTC)، ووثائق التصدير والجمارك.',
          features: [
            'صناديق فولاذية وخشبية معقمة معززة مخصصة',
            'تغليف واقٍ مقاوم للرطوبة والخدش',
            'تخطيط حمولة الحاويات وتوازن الوزن',
            'وثائق التصدير والامتثال الجمركي الشاملة',
          ],
          id: 'global-delivery',
          step: '04',
          title: 'الشحن والتصدير الدولي والتوثيق',
        },
      ],
      kicker: 'قدرات المصنع',
      stats: [
        ['تعميق التصميم', 'تنسيق بارامتري عبر BIM و Grasshopper'],
        ['التشكيل المعقد', 'درفلة CNC متعددة المحاور للألواح المنحنية'],
        ['التجميع التجريبي', 'فحص عينات 1:1 VMU و PMU'],
        ['التسليم الدولي', 'تعبئة مخصصة للتصدير وتنسيق لوجستي'],
      ],
      subtitle:
        'مسار عمل هندسي متكامل من 4 خطوات: من تعميق التصميم البارامتري إلى التشكيل المنحني المعقد، ونماذج 1:1، والتسليم للتصدير.',
      title: 'القدرات الهندسية والتصنيعية',
    },
    contact: {
      send: 'إرسال',
      sending: 'جارٍ الإرسال…',
      drawingStatus: 'حالة المخططات والنماذج',
      drawingStatusOptions: [
        ['ready', 'تتوفر مخططات / نماذج ثلاثية الأبعاد'],
        ['concept', 'مرحلة المفهوم (لا توجد مخططات بعد)'],
      ] as Array<[string, string]>,
      estimatedQuantity: 'الكمية التقديرية (م²)',
      inquiryIntent: 'نوع الطلب',
      inquiryIntentOptions: [
        ['standard_quote', 'طلب عرض سعر قياسي'],
        ['buildability_review', 'مراجعة قابلية التصنيع والتعميق الفني'],
      ] as Array<[string, string]>,
      optionalNote: 'اختياري (موصى به لتسريع التسعير)',
      projectStage: 'مرحلة المشروع',
      projectStageOptions: [
        ['concept', 'مرحلة المفهوم / التصميم الأولي'],
        ['tender', 'مرحلة المناقصة / العطاء'],
        ['procurement', 'مرحلة الشراء / أمر الشراء'],
        ['construction', 'قيد الإنشاء / التركيب في الموقع'],
      ] as Array<[string, string]>,
      submitWithoutDrawings:
        'يمكنك إرسال متطلبات مشروعك الآن، سواء مع مخططات أو بدونها.',
    },
    forProfessionals: {
      ctaButton: 'رفع مخططات المشروع',
      ctaSubtitle:
        'أرسل رسوماتك الأولية أو جداول الكميات أو ملفات النماذج ثلاثية الأبعاد للحصول على مراجعة هندسية وتجارية مباشرة من المصنع.',
      ctaTitle: 'هل أنت جاهز لمراجعة الجدوى الهندسية لمشروعك؟',
      kicker: 'للمهنيين والاستشاريين',
      roles: [
        {
          badge: 'التصميم والهندسة',
          description:
            'تحويل المفاهيم البارامترية والمنحنيات المعقدة إلى ألواح ألمنيوم دقيقة وقابلة للفحص دون المساومة على الرؤية المعمارية.',
          highlights: [
            'تقسيم الأسطح البارامترية وتحسين توزيع الألواح',
            'تنسيق الفواصل ومحاذاة المفاصل البصرية بدقة',
            'دعم عينات 1:1 VMU لاعتماد المعماري والمالك',
            'تأكيد تشطيبات الطلاء واللمعان المخصصة',
          ],
          id: 'architects',
          target: 'للمعماريين ومصممي الواجهات',
          title: 'المعماريون واستشاريو الواجهات',
        },
        {
          badge: 'التصنيع والتركيب',
          description:
            'تنسيق مباشر للرسومات التنفيذية من المصنع، هندسة واجهات التثبيت، وجداول تسليم مرحلية موثوقة للموقع.',
          highlights: [
            'مراجعة الرسومات التنفيذية والحسابات الهندسية',
            'تنسيق واجهات التثبيت مع الهيكل الإنشائي الثانوي',
            'ترميز الدفعات وتسمية تسلسل التركيب بوضوح',
            'إرشادات تفاوت الأبعاد والتركيب في الموقع',
          ],
          id: 'contractors',
          target: 'لمقاولي الواجهات والكسوات',
          title: 'مقاولو الواجهات وكسوات الجدران',
        },
        {
          badge: 'المشتريات والتكلفة',
          description:
            'تسعير جداول الكميات مباشرة من المصنع، شهادات مواد خام معتمدة، تعبئة متينة ولوجستيات تصدير شاملة.',
          highlights: [
            'تحليل تفصيلي لتكاليف جداول الكميات والهندسة القيمة',
            'شهادات فحص المصنع (MTC) وتقارير اختبار الطلاء',
            'حماية تعبئة مخصصة للتصدير وشحن بحري/جوي',
            'التزام صارم بالتواريخ والمراحل الزمنية للمشروع',
          ],
          id: 'procurement',
          target: 'للمقاولين الرئيسيين ومديري المشتريات',
          title: 'المقاولون الرئيسيون ومديرو المشتريات',
        },
      ],
      subtitle:
        'تنسيق هندسي متخصص، وتحليل جدوى التصنيع، ودعم تجاري مخصص للمعماريين ومقاولي الواجهات والمقاولين الرئيسيين.',
      title: 'الدعم الهندسي للمهنيين واستشاريي الواجهات',
    },
    home: {
      coreCapabilitiesKicker: 'حرفية وتصنيع المصنع',
      coreCapabilitiesSubtitle:
        'قدرة مصنع مصدر متخصصة في الألواح المنحنية المخصصة، وكواسر الشمس المعمارية، وأنظمة الواجهات المثقبة.',
      coreCapabilitiesTitle: 'تصنيع عالي الدقة للأشكال الهندسية المعقدة',
      craftsmanshipItems: [
        {
          description:
            'ألواح ألمنيوم أحادية ومزدوجة الانحناء ومخصصة للواجهات المعمارية.',
          id: 'double-curved',
          title: 'الألواح مزدوجة الانحناء والأشكال المعقدة',
        },
        {
          description:
            'كواسر شمس انسيابية، وزعانف معمارية، ومقاطع ألمنيوم مسحوبة مخصصة.',
          id: 'louvers',
          title: 'كواسر الشمس المنحنية والزعانف المعمارية',
        },
        {
          description:
            'تثقيب ليزري مخصص، وشاشات هندسية، وألواح مشربية معمارية.',
          id: 'mashrabiya',
          title: 'المشربية والألواح المعدنية المثقبة',
        },
      ],
      ctaButton: 'رفع المخططات',
      ctaKicker: 'ابدأ طلبك',
      ctaSubtitle:
        'أرسل رسوماتك التنفيذية أو ملفات النماذج ثلاثية الأبعاد أو جداول الكميات لتقييم مباشر من المصنع.',
      ctaTitle: 'هل أنت جاهز لمراجعة قابلية تصنيع واجهتك؟',
      exploreCapabilities: 'استكشف القدرات الهندسية',
      howIvySupportsKicker: 'مسار العمل الهندسي',
      howIvySupportsSubtitle:
        'نموذج هندسي مبسط من 4 خطوات: من تعميق التصميم إلى التصنيع الدقيق، وفحص النماذج، والتسليم للتصدير.',
      howIvySupportsTitle: 'كيف تدعم IVYBM مشروع واجهتك',
      professionalsBody:
        'من النمذجة البارامترية واعتماد النماذج إلى دفعات التسليم للموقع وتحسين جداول الكميات، نقدم تنسيقًا هندسيًا مباشرًا لكل شريك في المشروع.',
      professionalsCta: 'استكشف حلول المهنيين',
      professionalsKicker: 'حلول مخصصة',
      professionalsSubtitle:
        'تنسيق فني متخصص ومخرجات تجارية واضحة للمعماريين ومقاولي الواجهات ومديري المشتريات.',
      professionalsTitle: 'مصمم خصيصًا لصناع القرار في المشاريع',
      professionalSummaries: [
        {
          description:
            'تحسين الأشكال الهندسية، وترشيد الأسطح البارامترية، ودعم عينات VMU الفعلية.',
          id: 'architects',
          title: 'المعماريون والاستشاريون',
        },
        {
          description:
            'تنسيق الرسومات التنفيذية، وهندسة واجهات التثبيت، وجداول تسليم مرحلية للموقع.',
          id: 'contractors',
          title: 'مقاولو الواجهات',
        },
        {
          description:
            'تسعير جداول الكميات مباشرة من المصنع، وشهادات المواد المعتمدة، ولوجستيات التصدير.',
          id: 'procurement',
          title: 'المقاولون العامون والمشتريات',
        },
      ],
      supportItems: [
        {
          description:
            'مراجعة الأشكال الهندسية، وتقسيم الألواح، والرسومات التنفيذية، ومدخلات قابلية التصنيع.',
          id: 'design-engineering',
          step: '01',
          title: 'التصميم والهندسة',
        },
        {
          description:
            'ألواح ألمنيوم معمارية مسطحة ومنحنية ومثقبة وذات أشكال حرة.',
          id: 'complex-fabrication',
          step: '02',
          title: 'التصنيع المعقد',
        },
        {
          description:
            'عينات ممثلة، وفحص الأبعاد، ومراجعة التشطيب، والفحص قبل الشحن.',
          id: 'mockup-qc',
          step: '03',
          title: 'النماذج وضبط الجودة',
        },
        {
          description:
            'ترقيم الألواح، وتعبئة التصدير، وتخطيط الحاويات، وتنسيق الشحن.',
          id: 'global-delivery',
          step: '04',
          title: 'التسليم الدولي',
        },
      ],
      utilityLeft: 'ألمنيوم معماري لمشاريع الواجهات المعقدة',
      utilityRight: 'الهندسة · التصنيع · ضبط الجودة · التسليم الدولي',
    },
    knowledge: {
      allCategories: 'جميع المواضيع',
      backToKnowledge: 'العودة إلى قاعدة المعرفة',
      categories: {
        materialComparison: 'مقارنة المواد',
        procurement: 'المشتريات وجداول الكميات',
        qualityLogistics: 'الجودة واللوجستيات',
        technicalGuide: 'دليل فني',
      },
      consultButton: 'رفع المخططات للمراجعة',
      consultSubtitle:
        'استشر فريق هندسة الواجهات لدينا لتقييم مواصفات المواد وجدوى التصنيع.',
      consultTitle: 'هل تحتاج إلى استشارة فنية لمشروعك؟',
      kicker: 'قاعدة المعرفة',
      noArticles: 'لم يتم العثور على مقالات فنية في هذا القسم.',
      readTime: 'قراءة في {min} دقيقة',
      relatedTitle: 'مقالات فنية ذات صلة',
      subtitle:
        'مقالات هندسية، ومقارنات للمواد، ومعايير للتصنيع، وأدلة شراء للمظاريف المعمارية والواجهات الدولية.',
      title: 'قاعدة المعرفة الفنية للواجهات',
    },
    navigation: {
      about: 'من نحن',
      capabilities: 'القدرات الهندسية',
      contact: 'اتصل بنا',
      forProfessionals: 'للمهنيين والاستشاريين',
      home: 'الرئيسية',
      knowledge: 'المعرفة الفنية',
      news: 'الأخبار',
      products: 'المنتجات',
      projects: 'المشاريع',
    },
    pages: {
      capabilitiesSubtitle:
        'هندسة المصنع المصدر، وتعميق التصاميم البارامترية، والتصنيع المعقد، ونماذج 1:1، والتسليم للتصدير.',
      forProfessionalsSubtitle:
        'تنسيق هندسي ودعم مشتريات مخصص للمعماريين ومقاولي الواجهات والمقاولين الرئيسيين.',
      knowledgeSubtitle:
        'أدلة فنية، ومقارنات المواد، ومعايير الشراء، ورؤى هندسة الواجهات.',
    },
  },
}

export const getWebsiteV17Copy = (locale: Locale) => {
  const baseCopy = getWebsiteCopy(locale)
  const v17Extension = WEBSITE_V17_COPY[locale] || WEBSITE_V17_COPY.en

  return {
    ...baseCopy,
    actions: {
      ...baseCopy.actions,
      ...v17Extension.actions,
    },
    capabilities: v17Extension.capabilities,
    contact: {
      ...baseCopy.contact,
      ...v17Extension.contact,
    },
    forProfessionals: v17Extension.forProfessionals,
    home: {
      ...baseCopy.home,
      ...v17Extension.home,
    },
    knowledge: v17Extension.knowledge,
    navigation: {
      ...baseCopy.navigation,
      ...v17Extension.navigation,
    },
    pages: {
      ...baseCopy.pages,
      ...v17Extension.pages,
    },
  }
}
