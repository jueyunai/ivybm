export type OldSiteAsset = {
  alt: string
  filename: string
  sourceURL: string
}

type Direction = 'ltr' | 'rtl'
type Locale = 'ar' | 'en'
type RichTextNode = Record<string, unknown>
type Section = { heading: string; paragraphs: string[] }

type LocalizedArticle = {
  excerpt: string
  sections: Section[]
  title: string
}

type LocalizedProject = {
  application: string
  location: string
  sections: Section[]
  summary: string
  title: string
}

const textNode = (text: string): RichTextNode => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text,
  type: 'text',
  version: 1,
})

const blockNode = (
  type: 'heading' | 'paragraph',
  text: string,
  direction: Direction,
  tag?: 'h2' | 'h3',
): RichTextNode => ({
  children: [textNode(text)],
  direction,
  format: '',
  indent: 0,
  ...(tag ? { tag } : {}),
  textFormat: 0,
  textStyle: '',
  type,
  version: 1,
})

const uploadNode = (id: string, mediaID: number): RichTextNode => ({
  fields: {},
  format: '',
  id,
  relationTo: 'media',
  type: 'upload',
  value: mediaID,
  version: 1,
})

export const buildRichText = ({
  direction,
  imageIDs = [],
  key,
  sections,
}: {
  direction: Direction
  imageIDs?: number[]
  key: string
  sections: Section[]
}): Record<string, unknown> => {
  const children: RichTextNode[] = []

  sections.forEach((section, sectionIndex) => {
    children.push(blockNode('heading', section.heading, direction, 'h2'))
    children.push(
      ...section.paragraphs.map((paragraph) => blockNode('paragraph', paragraph, direction)),
    )

    const mediaID = imageIDs[sectionIndex]
    if (mediaID) children.push(uploadNode(`${key}-${sectionIndex + 1}`, mediaID))
  })

  return {
    root: {
      children,
      direction,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  }
}

export const OLD_SITE_ASSETS: OldSiteAsset[] = [
  ...([
    [
      'product-single-01.webp',
      'Single-curved aluminum panel sample',
      'https://www.ivy-metalglass.com/uploads/202235792/curved-aluminum-panels58493570062.jpg',
    ],
    [
      'product-single-02.webp',
      'Single-curved aluminum panels installed in an interior ceiling',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/20220114160031d764e68aa8754c2bb0af3149b5d6c533.jpg',
    ],
    [
      'product-single-03.webp',
      'Curved aluminum cladding on a public building',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/20220114160031c160de1ba6884d67a10210a8dd3476b4.jpg',
    ],
    [
      'product-single-04.webp',
      'Single-curved aluminum facade canopy',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/202201141600321230fd39631c40af941e06b7a7e32781.jpg',
    ],
    [
      'product-single-05.webp',
      'Curved aluminum ceiling application',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/20220114160032a90804d565e647ec88f1b5f72936ec99.jpg',
    ],
    [
      'product-double-01.webp',
      'Double-curved aluminum panel sample',
      'https://www.ivy-metalglass.com/uploads/202235792/double-curved-aluminum-panels24061212016.jpg',
    ],
    [
      'product-double-02.webp',
      'Double-curved aluminum panels used on a spherical landmark',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/202201141611242c624c9a26134596a65771bd8b3116c0.jpg',
    ],
    [
      'product-double-03.webp',
      'Double-curved aluminum facade application',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/20220114161125d5eac5b446fb49b2be9b3542bc76b1b1.jpg',
    ],
    [
      'product-double-04.webp',
      'Free-form double-curved aluminum building envelope',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/202201141611266b2c5b99e2e64ba58ce8b39f88cb7b7c.jpg',
    ],
    [
      'product-double-05.webp',
      'Double-curved aluminum panels on a sculptural building',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/202201141611269323dda2586d425683e7f5e274bc5a0b.jpg',
    ],
    [
      'product-solid-01.webp',
      'Copper-color standard facade aluminum panel sample',
      'https://www.ivy-metalglass.com/uploads/202235792/solid-aluminum-panels45321460668.jpg',
    ],
    [
      'product-solid-02.webp',
      'Standard facade aluminum panel construction detail',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/20220117094834f1827886183f425a93210adcf306a485.jpg',
    ],
    [
      'product-solid-03.webp',
      'Standard aluminum panel fabrication workflow',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/2022011709490788647bac4bb34ef1b6e9402e3dcd49bf.jpg',
    ],
    [
      'product-solid-04.webp',
      'RAL color selection for aluminum facade panels',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/202201170949316ef9a92910e549f295df9bcf828646cc.jpg',
    ],
    [
      'product-solid-05.webp',
      'Standard aluminum panels on a commercial facade',
      'https://www.ivy-metalglass.com/Content/uploads/2022859909/20220117095004134ddd8b12854234927ad7ca83083caf.jpg',
    ],
  ] as const),
  ...([
    [
      'project-canada-01.webp',
      'Canada double-curved panel digital model',
      'https://www.ivy-metalglass.com/uploads/35722/page/p20251126114351f57f3.jpg',
    ],
    [
      'project-canada-02.webp',
      'Canada double-curved panel first article',
      'https://www.ivy-metalglass.com/uploads/35722/page/p202511261145111570c.jpg',
    ],
    [
      'project-canada-03.webp',
      'Canada double-curved aluminum panel detail',
      'https://www.ivy-metalglass.com/uploads/35722/page/p202511261145128b5d9.jpg',
    ],
    [
      'project-canada-04.webp',
      'Canada double-curved aluminum panel fabrication',
      'https://www.ivy-metalglass.com/uploads/35722/page/p202511261145152f5ab.jpg',
    ],
    [
      'project-canada-05.webp',
      'Canada double-curved panels in factory production',
      'https://www.ivy-metalglass.com/uploads/35722/page/p202511261145188e139.jpg',
    ],
    [
      'project-canada-06.webp',
      'Canada double-curved panel production batch',
      'https://www.ivy-metalglass.com/uploads/35722/page/p202511261145250cd3d.jpg',
    ],
    [
      'project-canada-07.webp',
      'Canada double-curved panels ready for inspection',
      'https://www.ivy-metalglass.com/uploads/35722/page/p2025112611452733489.jpg',
    ],
    [
      'project-hong-kong-01.webp',
      'Hong Kong Tuen Mun copper-color double-curved facade',
      'https://www.ivy-metalglass.com/uploads/35722/page/p202511261147428af31.jpg',
    ],
    [
      'project-hong-kong-02.webp',
      'Hong Kong copper-color double-curved panel in production',
      'https://www.ivy-metalglass.com/uploads/35722/page/p202511261147452123b.jpg',
    ],
    [
      'project-hong-kong-03.webp',
      'Hong Kong double-curved panel packing frame',
      'https://www.ivy-metalglass.com/uploads/35722/page/p2025112611474834fcb.jpg',
    ],
    [
      'project-hong-kong-04.webp',
      'Hong Kong copper-color panels staged in factory',
      'https://www.ivy-metalglass.com/uploads/35722/page/p20251126114750f1602.jpg',
    ],
    [
      'project-shunde-01.webp',
      'Shunde Gymnasium curved facade structure',
      'https://www.ivy-metalglass.com/uploads/35722/page/p20251126115050e858f.jpg',
    ],
    [
      'project-shunde-02.webp',
      'Shunde Gymnasium curved panel digital model',
      'https://www.ivy-metalglass.com/uploads/35722/page/p20251126115023f636c.jpg',
    ],
    [
      'project-shunde-03.webp',
      'Shunde Gymnasium red curved aluminum panels during installation',
      'https://www.ivy-metalglass.com/uploads/35722/page/p202511261151354556d.jpg',
    ],
    [
      'project-shunde-04.webp',
      'Shunde Gymnasium curved aluminum cladding installation',
      'https://www.ivy-metalglass.com/uploads/35722/page/p20251126115138f2f3f.jpg',
    ],
  ] as const),
  ...([
    [
      'factory-cnc-bending.webp',
      'CNC aluminum panel bending machine',
      'https://www.ivy-metalglass.com/uploads/35722/page/2025123010075073bd5.jpg',
    ],
    [
      'factory-cnc-punching.webp',
      'CNC turret punching machine',
      'https://www.ivy-metalglass.com/uploads/35722/page/2025123010080469bb8.jpg',
    ],
    [
      'factory-inspection.webp',
      'Dimensional inspection of aluminum component',
      'https://www.ivy-metalglass.com/uploads/35722/page/2025122915345181722.jpg',
    ],
    [
      'factory-workshop.webp',
      'IVYBM aluminum fabrication workshop',
      'https://www.ivy-metalglass.com/uploads/35722/page/20251230102727f9ada.jpg',
    ],
    [
      'factory-loading.webp',
      'Export cargo loading at IVYBM factory',
      'https://www.ivy-metalglass.com/uploads/35722/page/20251230102749403cc.jpg',
    ],
    [
      'factory-warehouse.webp',
      'Finished aluminum products in warehouse',
      'https://www.ivy-metalglass.com/uploads/35722/page/2025123010275867b61.jpg',
    ],
  ] as const),
  ...([
    [
      'news-double-curved.webp',
      'Double-curved aluminum facade architecture',
      'https://www.ivy-metalglass.com/uploads/35722/news/p20251024090409c1eb6.png',
    ],
    [
      'news-surface-treatment.webp',
      'Finished aluminum panels after surface treatment',
      'https://www.ivy-metalglass.com/uploads/35722/news/p20260205171339d005f.png',
    ],
    [
      'news-thickness-guide.webp',
      'Standard aluminum facade panel samples',
      'https://www.ivy-metalglass.com/uploads/35722/news/p20260413093646f1722.png',
    ],
  ] as const),
].map(([filename, alt, sourceURL]) => ({ alt, filename, sourceURL }))

export const PRODUCT_ASSET_FILENAMES: Record<string, string[]> = {
  'double-curved-aluminum-panel': Array.from(
    { length: 5 },
    (_, index) => `product-double-0${index + 1}.webp`,
  ),
  'single-curved-aluminum-panel': Array.from(
    { length: 5 },
    (_, index) => `product-single-0${index + 1}.webp`,
  ),
  'solid-aluminum-panel': Array.from(
    { length: 5 },
    (_, index) => `product-solid-0${index + 1}.webp`,
  ),
}

export const OLD_SITE_PRODUCT_DESCRIPTIONS: Record<
  string,
  Record<Locale, { sections: Section[] }>
> = {
  'double-curved-aluminum-panel': {
    en: {
      sections: [
        {
          heading: 'A panel formed in two directions',
          paragraphs: [
            'Double-curved, or hyperbolic, aluminum panels are custom facade elements with curvature in two principal directions. They are developed from approved digital models, drawings, samples, interface details, and inspection requirements rather than selected as a standard off-the-shelf sheet.',
          ],
        },
        {
          heading: 'Applications and geometry review',
          paragraphs: [
            'Typical applications include landmark facades, atriums, lobbies, airports, stations, stadiums, museums, canopies, and sculptural interior features. Panelization, joints, support interfaces, transportation limits, and the visual transition between adjacent panels are reviewed together before production.',
          ],
        },
        {
          heading: 'From digital model to batch fabrication',
          paragraphs: [
            'The fabrication route can combine cutting, edge forming, bending or press forming, welding, reinforcement, grinding or polishing, cleaning, and the specified surface finish. Templates, first-article panels, and visual mock-ups can be coordinated where the geometry requires additional control before repeat production.',
          ],
        },
        {
          heading: 'Finish, inspection, and export delivery',
          paragraphs: [
            'Finish color, gloss, texture, batch range, sample direction, and repair limits should be agreed against an approved sample. Incoming material checks, in-process dimensional checks, final appearance review, panel identification, protective packing, labels, packing lists, and quality records can be coordinated to the project contract.',
          ],
        },
        {
          heading: 'Information requested for quotation',
          paragraphs: [
            'Please provide the 3D model or drawings, panel schedule, quantity, alloy or governing specification, finish reference, project location, support and joint concept, packing requirements, and target delivery date. This allows the team to review fabrication feasibility, sample requirements, interfaces, logistics, and technical risks before pricing.',
          ],
        },
        {
          heading: 'Project-specific parameters',
          paragraphs: [
            'All dimensions, thicknesses, alloys and tempers, loads, performance, tolerances, certifications, lead times, warranties, and final packing remain subject to project-specific engineering review, current test documents, approved drawings and samples, and contract confirmation.',
          ],
        },
      ],
    },
    ar: {
      sections: [
        {
          heading: 'لوح منحن في اتجاهين',
          paragraphs: [
            'ألواح الألمنيوم مزدوجة الانحناء أو الهايبر بولية هي عناصر واجهات مخصصة ذات انحناء في اتجاهين رئيسيين. ويتم تطويرها من النماذج الرقمية والرسومات والعينات وتفاصيل الربط ومتطلبات الفحص المعتمدة، وليست منتجا قياسيا جاهزا.',
          ],
        },
        {
          heading: 'الاستخدامات ومراجعة الشكل',
          paragraphs: [
            'تشمل الاستخدامات المعتادة الواجهات المميزة والردهات والمطارات والمحطات والملاعب والمتاحف والمظلات والعناصر الداخلية النحتية. وتراجع تقسيمات الألواح والفواصل ونقاط الربط والدعم وحدود النقل والانتقال البصري بين الألواح معا قبل الإنتاج.',
          ],
        },
        {
          heading: 'من النموذج الرقمي إلى الإنتاج الكمي',
          paragraphs: [
            'يمكن أن يجمع مسار التصنيع بين القص وتشكيل الحواف والثني أو الكبس واللحام والتدعيم والتجليخ أو التلميع والتنظيف والتشطيب المحدد. ويمكن تنسيق القوالب والعينة الأولى والنموذج البصري عندما يحتاج الشكل إلى ضبط إضافي قبل الإنتاج المتكرر.',
          ],
        },
        {
          heading: 'التشطيب والفحص وتسليم التصدير',
          paragraphs: [
            'يجب اعتماد اللون واللمعان والملمس ونطاق اختلاف الدفعة واتجاه العينة وحدود الإصلاح مقابل عينة معتمدة. ويمكن تنسيق فحص المواد الواردة وفحص الأبعاد أثناء التصنيع والمظهر النهائي وترقيم الألواح وحماية التغليف والملصقات وقوائم التعبئة وسجلات الجودة وفقا لعقد المشروع.',
          ],
        },
        {
          heading: 'المعلومات المطلوبة للتسعير',
          paragraphs: [
            'يرجى تقديم النموذج ثلاثي الأبعاد أو الرسومات وجدول الألواح والكمية والسبيكة أو المواصفة المرجعية ومرجع التشطيب وموقع المشروع ونظام الدعم والفواصل ومتطلبات التغليف وموعد التسليم المستهدف، حتى يمكن مراجعة قابلية التصنيع والعينات والواجهات واللوجستيات والمخاطر الفنية قبل التسعير.',
          ],
        },
        {
          heading: 'معايير خاصة بكل مشروع',
          paragraphs: [
            'تخضع جميع الأبعاد والسماكات والسبائك والحالات الحرارية والأحمال والأداء والتفاوتات والشهادات ومواعيد التسليم والضمان والتغليف النهائي للمراجعة الهندسية الخاصة بالمشروع ووثائق الاختبار الحالية والرسومات والعينات المعتمدة وتأكيد العقد.',
          ],
        },
      ],
    },
  },
  'single-curved-aluminum-panel': {
    en: {
      sections: [
        {
          heading: 'Controlled curvature for one-directional forms',
          paragraphs: [
            'Single-curved, or waved, aluminum panels are formed to a project-specific radius in one principal direction. They support repeatable curved zones while keeping panel edges, joints, returns, stiffeners, and fixing interfaces coordinated with the approved shop drawings.',
          ],
        },
        {
          heading: 'Where single-curved panels fit',
          paragraphs: [
            'Typical uses include curved columns, roof and canopy bands, soffits, ceilings, arc-shaped facade zones, and curved curtain-wall areas. Radius, module size, flat-to-curved transitions, support spacing, and site interfaces should be reviewed as one system.',
          ],
        },
        {
          heading: 'Engineering and sample workflow',
          paragraphs: [
            'Quotation and engineering review can start from approved 2D drawings, a 3D STEP or IGES model, or a physical sample. The workflow may include technical clarification, shop drawings, material and color samples, a first article, and a visual or performance mock-up where required by the project.',
          ],
        },
        {
          heading: 'Inspection and delivery control',
          paragraphs: [
            'Incoming material, thickness, key dimensions, diagonal and curvature checks, interfaces, welds, ground edges, flatness, color, gloss, coating appearance, protective film, separation, labels, packing lists, and packing strength can be included in the agreed inspection plan.',
          ],
        },
        {
          heading: 'Information requested for quotation',
          paragraphs: [
            'Send drawings or the 3D model, radius and panel dimensions, quantity or panel schedule, material and finish requirements, support and joint concept, project destination, packing needs, and target delivery date. Prototype, sample, and inspection-report requirements should be stated before pricing.',
          ],
        },
        {
          heading: 'Project-specific parameters',
          paragraphs: [
            'Final radius, dimensions, thickness, alloy, finish, structural and fire performance, tolerances, certification, lead time, warranty, and packing are confirmed only through approved project documents, samples, engineering review, and contract.',
          ],
        },
      ],
    },
    ar: {
      sections: [
        {
          heading: 'انحناء مضبوط للأشكال أحادية الاتجاه',
          paragraphs: [
            'تشكل ألواح الألمنيوم أحادية الانحناء أو المموجة بنصف قطر خاص بالمشروع في اتجاه رئيسي واحد. وهي تدعم المناطق المنحنية المتكررة مع تنسيق الحواف والفواصل والمرتجعات والدعامات ونقاط التثبيت مع الرسومات التنفيذية المعتمدة.',
          ],
        },
        {
          heading: 'مجالات استخدام الألواح أحادية الانحناء',
          paragraphs: [
            'تشمل الاستخدامات المعتادة الأعمدة المنحنية وشرائط الأسقف والمظلات والأسطح السفلية والأسقف الداخلية ومناطق الواجهات القوسية والستائر المنحنية. ويجب مراجعة نصف القطر وحجم الوحدة والانتقال بين المسطح والمنحني وتباعد الدعامات ونقاط الربط كنظام واحد.',
          ],
        },
        {
          heading: 'مسار الهندسة والعينات',
          paragraphs: [
            'يمكن بدء التسعير والمراجعة الهندسية من رسومات ثنائية الأبعاد معتمدة أو نموذج ثلاثي الأبعاد بصيغة STEP أو IGES أو عينة فعلية. وقد يشمل المسار الاستيضاحات الفنية والرسومات التنفيذية وعينات المادة واللون والعينة الأولى والنموذج البصري أو نموذج الأداء حسب متطلبات المشروع.',
          ],
        },
        {
          heading: 'الفحص وضبط التسليم',
          paragraphs: [
            'يمكن أن تشمل خطة الفحص المتفق عليها المواد الواردة والسماكة والأبعاد الرئيسية والأقطار والانحناء ونقاط الربط واللحامات والحواف المصقولة والاستواء واللون واللمعان ومظهر الطلاء والغشاء الواقي والفواصل والملصقات وقوائم التعبئة وقوة التغليف.',
          ],
        },
        {
          heading: 'المعلومات المطلوبة للتسعير',
          paragraphs: [
            'أرسل الرسومات أو النموذج ثلاثي الأبعاد ونصف القطر وأبعاد الألواح والكمية أو جدول الألواح ومتطلبات المادة والتشطيب ونظام الدعم والفواصل ووجهة المشروع واحتياجات التغليف وموعد التسليم المستهدف، مع تحديد متطلبات النموذج والعينة وتقارير الفحص قبل التسعير.',
          ],
        },
        {
          heading: 'معايير خاصة بكل مشروع',
          paragraphs: [
            'لا يتم تأكيد نصف القطر والأبعاد والسماكة والسبيكة والتشطيب والأداء الإنشائي والحريق والتفاوتات والشهادات والمدة والضمان والتغليف إلا من خلال وثائق المشروع والعينات والمراجعة الهندسية والعقد المعتمد.',
          ],
        },
      ],
    },
  },
  'solid-aluminum-panel': {
    en: {
      sections: [
        {
          heading: 'Project-made solid aluminum facade panels',
          paragraphs: [
            'Solid aluminum panels are project-fabricated facade elements that can combine a face sheet, folded returns, stiffeners, fixing angles, brackets, or cassette interfaces. Flat, folded, curved, perforated, and special-shaped modules can be coordinated to approved drawings and samples.',
          ],
        },
        {
          heading: 'Applications and finish selection',
          paragraphs: [
            'Common applications include curtain-wall cladding, exterior walls, ceilings, parapets, lobbies, partitions, lattice or mashrabiya screens, and other durable decorative systems. Anodized, powder, polyester, PVDF or other specified coatings, painted colors, and wood or stone transfer finishes are selected against the project specification and approved sample.',
          ],
        },
        {
          heading: 'Drawing and interface coordination',
          paragraphs: [
            'Panel size, thickness, alloy or grade, returns, reinforcement, fixing method, open or sealed joints, support layout, transport limits, and site installation sequence should be reviewed together. Factory forming can reduce site cutting when the shop drawings and interfaces are approved before production.',
          ],
        },
        {
          heading: 'Quality and export packing',
          paragraphs: [
            'The agreed quality plan can cover incoming material, dimensions, welding and grinding, edge condition, appearance, coating and color range, protective film, separation, labels, packing lists, and pre-shipment review. Export packing may use waterproof inner paper, protective outer framing or iron packaging, and treated wood pallets where confirmed by the contract and logistics plan.',
          ],
        },
        {
          heading: 'Information requested for quotation',
          paragraphs: [
            'Provide the drawings, panel dimensions and quantity, alloy or grade, thickness, coating or finish, color sample, application, support and joint concept, destination, packing requirement, governing specification, and target delivery date. Any required certificates, test reports, visual mock-ups, or inspection records should be identified at enquiry stage.',
          ],
        },
        {
          heading: 'Project-specific parameters',
          paragraphs: [
            'All product ranges, dimensions, loads, performance, certification, color tolerance, coating system, warranty, MOQ, lead time, commercial terms, and final packing are subject to current supporting documents, engineering review, approved samples, and contract confirmation.',
          ],
        },
      ],
    },
    ar: {
      sections: [
        {
          heading: 'ألواح واجهات ألمنيوم مصمتة حسب المشروع',
          paragraphs: [
            'ألواح الألمنيوم المصمتة هي عناصر واجهات تصنع حسب المشروع ويمكن أن تجمع بين وجه اللوح والمرتجعات المطوية والدعامات وزوايا التثبيت أو أنظمة الكاسيت. ويمكن تنسيق الوحدات المسطحة والمطوية والمنحنية والمثقبة والخاصة وفقا للرسومات والعينات المعتمدة.',
          ],
        },
        {
          heading: 'الاستخدامات واختيار التشطيب',
          paragraphs: [
            'تشمل الاستخدامات المعتادة كسوة الستائر والجدران الخارجية والأسقف والبارابيت والردهات والقواطع والشبكات أو شاشات المشربية والأنظمة الزخرفية المتينة. ويتم اختيار الأنودة أو البودرة أو البوليستر أو PVDF أو غيرها من أنظمة الطلاء والألوان ونقل شكل الخشب أو الحجر حسب مواصفات المشروع والعينة المعتمدة.',
          ],
        },
        {
          heading: 'تنسيق الرسومات ونقاط الربط',
          paragraphs: [
            'يجب مراجعة المقاس والسماكة والسبيكة أو الدرجة والمرتجعات والتدعيم وطريقة التثبيت والفواصل المفتوحة أو المحكمة ونظام الدعم وحدود النقل وتسلسل التركيب معا. ويمكن أن يقلل التشكيل في المصنع أعمال القص في الموقع عند اعتماد الرسومات التنفيذية والواجهات قبل الإنتاج.',
          ],
        },
        {
          heading: 'الجودة وتغليف التصدير',
          paragraphs: [
            'يمكن أن تغطي خطة الجودة المتفق عليها المواد الواردة والأبعاد واللحام والتجليخ وحالة الحواف والمظهر والطلاء ونطاق اللون والغشاء الواقي والفواصل والملصقات وقوائم التعبئة ومراجعة ما قبل الشحن. ويمكن استخدام ورق داخلي مقاوم للماء وإطار واق أو تغليف حديدي ومنصات خشبية معالجة عندما يؤكد العقد والخطة اللوجستية ذلك.',
          ],
        },
        {
          heading: 'المعلومات المطلوبة للتسعير',
          paragraphs: [
            'قدم الرسومات وأبعاد الألواح والكمية والسبيكة أو الدرجة والسماكة والطلاء أو التشطيب وعينة اللون والاستخدام ونظام الدعم والفواصل والوجهة ومتطلبات التغليف والمواصفة المرجعية وموعد التسليم المستهدف، مع تحديد الشهادات أو تقارير الاختبار أو النماذج البصرية أو سجلات الفحص المطلوبة عند الاستفسار.',
          ],
        },
        {
          heading: 'معايير خاصة بكل مشروع',
          paragraphs: [
            'تخضع جميع نطاقات المنتج والأبعاد والأحمال والأداء والشهادات وتفاوت اللون ونظام الطلاء والضمان والحد الأدنى للطلب والمدة والشروط التجارية والتغليف النهائي للوثائق الداعمة الحالية والمراجعة الهندسية والعينات المعتمدة وتأكيد العقد.',
          ],
        },
      ],
    },
  },
}

export const OLD_SITE_PROJECTS: Array<{
  ar: LocalizedProject
  assetFilenames: string[]
  en: LocalizedProject
  slug: string
}> = [
  {
    slug: 'canada-double-curved',
    assetFilenames: Array.from({ length: 7 }, (_, index) => `project-canada-0${index + 1}.webp`),
    en: {
      title: 'Canada Double-Curved Aluminum Panel Project',
      location: 'Canada',
      application: 'Double-curved aluminum panels',
      summary: 'From coordinated 3D geometry to batch fabrication, inspection, and export staging.',
      sections: [
        {
          heading: 'Project overview',
          paragraphs: [
            'This reference records the development of custom double-curved aluminum panels for a Canadian project. The work progressed from digital geometry and trial pieces to forming, welding, surface preparation, dimensional review, and batch production.',
          ],
        },
        {
          heading: 'Factory delivery scope',
          paragraphs: [
            'The production sequence included panelization review, first-article checks, repeat fabrication, panel identification, inspection staging, and export packing coordination. The gallery shows both the coordinated model and the manufactured panels.',
          ],
        },
      ],
    },
    ar: {
      title: 'مشروع ألواح ألمنيوم مزدوجة الانحناء في كندا',
      location: 'كندا',
      application: 'ألواح ألمنيوم مزدوجة الانحناء',
      summary: 'من تنسيق النموذج ثلاثي الأبعاد إلى التصنيع والفحص وتجهيز الشحنة.',
      sections: [
        {
          heading: 'نظرة عامة على المشروع',
          paragraphs: [
            'يوثق هذا المرجع تطوير ألواح ألمنيوم مزدوجة الانحناء حسب الطلب لمشروع في كندا، بدءا من النموذج الرقمي والعينات الأولية وصولا إلى التشكيل واللحام وتجهيز السطح وفحص الأبعاد والإنتاج الكمي.',
          ],
        },
        {
          heading: 'نطاق التوريد من المصنع',
          paragraphs: [
            'شمل مسار الإنتاج مراجعة تقسيم الألواح وفحص العينة الأولى والتصنيع المتكرر وترقيم الألواح وتجهيزها للفحص وتنسيق تغليف التصدير. ويعرض المعرض النموذج المنسق والألواح المصنعة.',
          ],
        },
      ],
    },
  },
  {
    slug: 'hong-kong-tuen-mun-double-curved-copper-panel',
    assetFilenames: Array.from({ length: 4 }, (_, index) => `project-hong-kong-0${index + 1}.webp`),
    en: {
      title: 'Hong Kong Tuen Mun Double-Curved Copper-Color Panels',
      location: 'Tuen Mun, Hong Kong',
      application: 'Double-curved copper-color aluminum panels',
      summary: 'Copper-color double-curved panels coordinated for a layered architectural facade.',
      sections: [
        {
          heading: 'Project overview',
          paragraphs: [
            'The Tuen Mun project combines repeated double-curved panel geometry with a copper-color architectural finish. Factory work covered forming, edge and support coordination, finish review, panel protection, and delivery staging.',
          ],
        },
        {
          heading: 'Fabrication evidence',
          paragraphs: [
            'The gallery connects the installed facade appearance with workshop production and dedicated packing frames. This helps project teams review how complex panel geometry is protected between fabrication and site delivery.',
          ],
        },
      ],
    },
    ar: {
      title: 'ألواح مزدوجة الانحناء بلون النحاس في توين مون، هونغ كونغ',
      location: 'توين مون، هونغ كونغ',
      application: 'ألواح ألمنيوم مزدوجة الانحناء بلون النحاس',
      summary: 'ألواح مزدوجة الانحناء بلون نحاسي لواجهة معمارية متعددة الطبقات.',
      sections: [
        {
          heading: 'نظرة عامة على المشروع',
          paragraphs: [
            'يجمع مشروع توين مون بين هندسة متكررة مزدوجة الانحناء وتشطيب معماري بلون النحاس. وشمل العمل في المصنع التشكيل وتنسيق الحواف والدعامات ومراجعة التشطيب وحماية الألواح وتجهيزها للتسليم.',
          ],
        },
        {
          heading: 'أدلة التصنيع',
          paragraphs: [
            'يربط المعرض بين مظهر الواجهة بعد التركيب والإنتاج داخل الورشة وإطارات التغليف المخصصة، بما يوضح طريقة حماية الألواح المعقدة من التصنيع حتى التسليم للموقع.',
          ],
        },
      ],
    },
  },
  {
    slug: 'shunde-gymnasium',
    assetFilenames: Array.from({ length: 4 }, (_, index) => `project-shunde-0${index + 1}.webp`),
    en: {
      title: 'Shunde Gymnasium Curved Aluminum Cladding',
      location: 'Shunde, Foshan, China',
      application: 'Curved aluminum cladding',
      summary:
        'Digital coordination and site installation of sweeping curved aluminum cladding bands.',
      sections: [
        {
          heading: 'Project overview',
          paragraphs: [
            'Shunde Gymnasium uses long curved cladding bands to define circulation and public spaces. The panel geometry was coordinated digitally before fabrication and installed against the curved steel support structure.',
          ],
        },
        {
          heading: 'Design-to-site coordination',
          paragraphs: [
            'The project record shows the supporting structure, coordinated panel model, and installation stages. Matching the model, panel sequence, joints, and site interfaces was essential to preserve the continuous curve.',
          ],
        },
      ],
    },
    ar: {
      title: 'كسوة ألمنيوم منحنية لملعب شونده',
      location: 'شونده، فوشان، الصين',
      application: 'كسوة ألمنيوم منحنية',
      summary: 'تنسيق رقمي وتركيب موقعي لشرائط كسوة ألمنيوم منحنية ممتدة.',
      sections: [
        {
          heading: 'نظرة عامة على المشروع',
          paragraphs: [
            'يستخدم ملعب شونده شرائط كسوة منحنية طويلة لتحديد مسارات الحركة والمساحات العامة. وتم تنسيق هندسة الألواح رقميا قبل التصنيع وتركيبها على الهيكل الفولاذي المنحني.',
          ],
        },
        {
          heading: 'التنسيق من التصميم إلى الموقع',
          paragraphs: [
            'يعرض سجل المشروع الهيكل الداعم والنموذج المنسق ومراحل التركيب. وكان تطابق النموذج وتسلسل الألواح والفواصل ونقاط الربط في الموقع ضروريا للحفاظ على استمرارية المنحنى.',
          ],
        },
      ],
    },
  },
]

export const OLD_SITE_POSTS: Array<{
  ar: LocalizedArticle
  category: 'industry' | 'products'
  en: LocalizedArticle
  featuredFilename: string
  publishedAt: string
  slug: string
}> = [
  {
    slug: 'what-is-double-curved-aluminum-panel',
    category: 'products',
    featuredFilename: 'news-double-curved.webp',
    publishedAt: '2026-06-18T00:00:00.000Z',
    en: {
      title: 'What Is a Double-Curved Aluminum Panel?',
      excerpt:
        'How two-directional geometry, forming, welding, and finishing create free-form aluminum facade surfaces.',
      sections: [
        {
          heading: 'A panel formed in two directions',
          paragraphs: [
            'A double-curved aluminum panel has curvature in two principal directions. Unlike a flat or single-radius panel, it can follow spherical, twisted, flowing, or other free-form architectural surfaces.',
          ],
        },
        {
          heading: 'How it is manufactured',
          paragraphs: [
            'Production commonly combines cutting, edge forming, bending or press forming, welding, reinforcement, grinding, and the specified surface finish. Digital models, templates, first-article panels, and visual mock-ups help control the transition between adjacent panels.',
          ],
        },
        {
          heading: 'Where it is used',
          paragraphs: [
            'Typical applications include airports, stations, stadiums, museums, landmark commercial facades, atriums, canopies, and sculptural interior features. Panel size and thickness are selected for the geometry, support layout, loads, finish, transportation, and installation method.',
          ],
        },
        {
          heading: 'Information needed for a quotation',
          paragraphs: [
            'Send the 3D model or drawings, panel schedule, quantity, alloy or specification, finish, project location, packing requirements, and target delivery date. This allows the fabrication plan and technical risks to be reviewed before pricing.',
          ],
        },
      ],
    },
    ar: {
      title: 'ما هو لوح الألمنيوم مزدوج الانحناء؟',
      excerpt:
        'كيف تصنع الهندسة ثنائية الاتجاه والتشكيل واللحام والتشطيب أسطح واجهات ألمنيوم حرة الشكل.',
      sections: [
        {
          heading: 'لوح منحن في اتجاهين',
          paragraphs: [
            'يمتلك لوح الألمنيوم مزدوج الانحناء انحناء في اتجاهين رئيسيين. وعلى خلاف اللوح المسطح أو أحادي نصف القطر، يمكنه اتباع الأسطح الكروية أو الملتوية أو الانسيابية وغيرها من الأشكال المعمارية الحرة.',
          ],
        },
        {
          heading: 'طريقة التصنيع',
          paragraphs: [
            'يجمع الإنتاج عادة بين القص وتشكيل الحواف والثني أو الكبس واللحام والتدعيم والصقل ونظام التشطيب المحدد. وتساعد النماذج الرقمية والقوالب والعينة الأولى والنموذج البصري على ضبط الانتقال بين الألواح المتجاورة.',
          ],
        },
        {
          heading: 'مجالات الاستخدام',
          paragraphs: [
            'تشمل الاستخدامات المعتادة المطارات والمحطات والملاعب والمتاحف والواجهات التجارية المميزة والردهات والمظلات والعناصر الداخلية النحتية. ويتم اختيار المقاس والسماكة وفق الشكل ونظام الدعم والأحمال والتشطيب والنقل والتركيب.',
          ],
        },
        {
          heading: 'المعلومات المطلوبة للتسعير',
          paragraphs: [
            'يرجى إرسال النموذج ثلاثي الأبعاد أو الرسومات وجدول الألواح والكمية والسبيكة أو المواصفة والتشطيب وموقع المشروع ومتطلبات التغليف وموعد التسليم المستهدف.',
          ],
        },
      ],
    },
  },
  {
    slug: 'aluminum-panel-surface-treatments',
    category: 'industry',
    featuredFilename: 'news-surface-treatment.webp',
    publishedAt: '2026-06-10T00:00:00.000Z',
    en: {
      title: 'Aluminum Panel Surface Treatments: Anodizing and Electrostatic Spraying',
      excerpt:
        'A practical comparison of color range, consistency, durability, and project controls for architectural aluminum panels.',
      sections: [
        {
          heading: 'Why the finish matters',
          paragraphs: [
            'The finish controls color, gloss, texture, weather exposure, cleaning, and the visual consistency of a facade. It should be selected with the alloy, forming process, exposure environment, approved sample, and project specification.',
          ],
        },
        {
          heading: 'Anodizing',
          paragraphs: [
            'Anodizing forms a protective oxide layer on the aluminum surface. It provides a metallic appearance, but color range is more limited and shade variation can become visible when many panels are installed together. Batch control and an agreed range sample are important.',
          ],
        },
        {
          heading: 'Electrostatic spraying',
          paragraphs: [
            'Powder and liquid coating systems provide a broader color and texture range. Powder coatings can offer strong impact and abrasion resistance; liquid coating systems are often selected for exterior architectural color and weathering requirements. Metallic pigments, panel orientation, gloss, and long-term ultraviolet exposure require careful sample review.',
          ],
        },
        {
          heading: 'Project inspection points',
          paragraphs: [
            'Confirm the coating system, color reference, gloss, texture, film requirements, pretreatment, sample direction, repair limits, packing protection, and acceptance method before production. Finished panels should be viewed together under representative light before shipment.',
          ],
        },
      ],
    },
    ar: {
      title: 'معالجات أسطح ألواح الألمنيوم: الأنودة والرش الكهروستاتيكي',
      excerpt:
        'مقارنة عملية لنطاق الألوان والتجانس والمتانة وضوابط المشروع لألواح الألمنيوم المعمارية.',
      sections: [
        {
          heading: 'أهمية نظام التشطيب',
          paragraphs: [
            'يتحكم التشطيب في اللون واللمعان والملمس والتعرض للطقس والتنظيف والتجانس البصري للواجهة. ويجب اختياره بالتنسيق مع السبيكة وعملية التشكيل وبيئة التعرض والعينة المعتمدة ومواصفات المشروع.',
          ],
        },
        {
          heading: 'الأنودة',
          paragraphs: [
            'تكون الأنودة طبقة أكسيد واقية على سطح الألمنيوم وتوفر مظهرا معدنياً، لكن نطاق الألوان أكثر محدودية وقد يظهر اختلاف الدرجة عند تركيب عدد كبير من الألواح. لذلك تعد مراقبة الدفعة واعتماد نطاق لوني مرجعي أمرين مهمين.',
          ],
        },
        {
          heading: 'الرش الكهروستاتيكي',
          paragraphs: [
            'توفر أنظمة الطلاء بالبودرة والطلاء السائل نطاقا أوسع من الألوان والملمس. ويمكن للطلاء بالبودرة توفير مقاومة جيدة للصدمات والاحتكاك، بينما تستخدم أنظمة الطلاء السائل كثيرا لمتطلبات اللون والتعرض الخارجي. ويجب مراجعة الأصباغ المعدنية واتجاه الألواح واللمعان والتعرض الطويل للأشعة فوق البنفسجية.',
          ],
        },
        {
          heading: 'نقاط فحص المشروع',
          paragraphs: [
            'يجب تأكيد نظام الطلاء ومرجع اللون واللمعان والملمس ومتطلبات السماكة والمعالجة الأولية واتجاه العينة وحدود الإصلاح وحماية التغليف وطريقة القبول قبل الإنتاج.',
          ],
        },
      ],
    },
  },
  {
    slug: 'aluminum-panel-thickness-guide',
    category: 'industry',
    featuredFilename: 'news-thickness-guide.webp',
    publishedAt: '2026-04-13T00:00:00.000Z',
    en: {
      title: 'Aluminum Panel Nominal and Actual Thickness Comparison Table',
      excerpt:
        'Nominal thickness, base material, panel size, loads, supports, and finish must be reviewed together.',
      sections: [
        {
          heading: 'Thickness is an engineering choice',
          paragraphs: [
            'Architectural aluminum panels are commonly specified in nominal thicknesses such as 1.5, 2.0, 2.5, and 3.0 mm, while 4.0 and 5.0 mm panels can be produced for project-specific requirements. The correct choice depends on panel size, geometry, alloy and temper, stiffener layout, wind loads, fixing points, and acceptance criteria.',
          ],
        },
        {
          heading: 'Nominal and actual base material',
          paragraphs: [
            'Procurement documents should state the governing standard and whether a value refers to nominal thickness or measured base material. The old IVY reference table pairs 1.5 / 2.0 / 2.5 / 3.0 / 4.0 / 5.0 mm nominal values with 1.35 / 1.85 / 2.35 / 2.85 / 3.9 / 5.0 mm base material values. Confirm the applicable project standard before ordering.',
          ],
        },
        {
          heading: 'Exterior and interior applications',
          paragraphs: [
            'Exterior facade panels usually require greater stiffness and weather resistance than interior decorative panels. Larger modules, curved geometry, perforations, deep returns, or widely spaced supports may require a thicker sheet or additional reinforcement.',
          ],
        },
        {
          heading: 'What to send for review',
          paragraphs: [
            'Provide elevations, panel dimensions, joint layout, support concept, design loads, alloy and temper, finish, perforation or curvature, destination, and the governing specification. A project-specific review is more reliable than selecting thickness from a general chart alone.',
          ],
        },
      ],
    },
    ar: {
      title: 'جدول مقارنة السماكة الاسمية والفعلية لألواح الألمنيوم',
      excerpt:
        'يجب مراجعة السماكة الاسمية والمادة الأساسية والمقاس والأحمال والدعامات والتشطيب معا.',
      sections: [
        {
          heading: 'السماكة قرار هندسي',
          paragraphs: [
            'تحدد ألواح الألمنيوم المعمارية عادة بسماكات اسمية مثل 1.5 و2.0 و2.5 و3.0 مم، كما يمكن إنتاج ألواح 4.0 و5.0 مم لمتطلبات خاصة. ويعتمد الاختيار الصحيح على المقاس والشكل والسبيكة والحالة الحرارية والدعامات وأحمال الرياح ونقاط التثبيت ومعايير القبول.',
          ],
        },
        {
          heading: 'السماكة الاسمية والمادة الأساسية الفعلية',
          paragraphs: [
            'يجب أن تحدد وثائق الشراء المعيار المرجعي وما إذا كانت القيمة تشير إلى السماكة الاسمية أو قياس المادة الأساسية. يربط جدول IVY المرجعي القديم القيم الاسمية 1.5 و2.0 و2.5 و3.0 و4.0 و5.0 مم بقيم مادة أساسية 1.35 و1.85 و2.35 و2.85 و3.9 و5.0 مم. ويجب تأكيد معيار المشروع قبل الطلب.',
          ],
        },
        {
          heading: 'الاستخدامات الخارجية والداخلية',
          paragraphs: [
            'تحتاج ألواح الواجهات الخارجية عادة إلى صلابة ومقاومة للعوامل الجوية أكبر من الألواح الداخلية الزخرفية. وقد تتطلب المقاسات الكبيرة أو الأشكال المنحنية أو الثقوب أو الحواف العميقة أو الدعامات المتباعدة سماكة أكبر أو تدعيما إضافيا.',
          ],
        },
        {
          heading: 'المعلومات المطلوبة للمراجعة',
          paragraphs: [
            'يرجى تقديم الواجهات وأبعاد الألواح والفواصل ونظام الدعم والأحمال التصميمية والسبيكة والحالة الحرارية والتشطيب والثقوب أو الانحناء والوجهة والمواصفة المرجعية.',
          ],
        },
      ],
    },
  },
]

export const buildLocalizedContent = (
  locale: Locale,
  sections: Section[],
  key: string,
  imageIDs: number[] = [],
) => buildRichText({ direction: locale === 'ar' ? 'rtl' : 'ltr', imageIDs, key, sections })

export const ABOUT_SECTIONS: Record<Locale, Section[]> = {
  en: [
    {
      heading: 'Aluminum fabrication for project delivery',
      paragraphs: [
        'Foshan Ivy Building Materials Co., Ltd. coordinates architectural aluminum panel fabrication from drawing review and material preparation through forming, inspection, packing, and export delivery. The factory supports standard, single-curved, and double-curved aluminum panel projects.',
      ],
    },
    {
      heading: 'CNC fabrication capability',
      paragraphs: [
        'CNC bending and turret punching equipment support repeatable cutting, perforation, edge forming, and panel geometry. Project-specific templates, shop drawings, and first-article checks are used where the geometry requires additional control.',
      ],
    },
    {
      heading: 'Quality control from incoming material to shipment',
      paragraphs: [
        'IQC verifies supplier certificates, material reports, appearance, and incoming dimensions. IPQC checks fabrication stages; FQC reviews finished dimensions and appearance; OQC confirms packing, labels, certificates, and shipment protection. QA / CA uses inspection results and feedback to improve process controls.',
      ],
    },
    {
      heading: 'Export packing and traceability',
      paragraphs: [
        'Finished panels are identified, protected, staged, and packed for the agreed delivery sequence. Packing lists, labels, quality records, and shipment documentation can be coordinated to the project contract.',
      ],
    },
  ],
  ar: [
    {
      heading: 'تصنيع الألمنيوم لتسليم المشاريع',
      paragraphs: [
        'تنسق شركة Foshan Ivy Building Materials Co., Ltd. تصنيع ألواح الألمنيوم المعمارية من مراجعة الرسومات وتجهيز المواد إلى التشكيل والفحص والتغليف والتسليم للتصدير. ويدعم المصنع مشاريع الألواح القياسية وأحادية الانحناء ومزدوجة الانحناء.',
      ],
    },
    {
      heading: 'قدرات التصنيع باستخدام CNC',
      paragraphs: [
        'تدعم معدات الثني والتثقيب CNC عمليات القص والثقب وتشكيل الحواف وهندسة الألواح بصورة قابلة للتكرار. وتستخدم القوالب والرسومات التنفيذية وفحص العينة الأولى عندما يتطلب الشكل تحكما إضافيا.',
      ],
    },
    {
      heading: 'ضبط الجودة من المواد الواردة إلى الشحن',
      paragraphs: [
        'يتحقق IQC من شهادات المورد وتقارير المواد والمظهر والأبعاد الواردة. ويراجع IPQC مراحل التصنيع، ويفحص FQC أبعاد ومظهر المنتج النهائي، ويؤكد OQC التغليف والملصقات والشهادات وحماية الشحنة. وتستخدم QA / CA نتائج الفحص والملاحظات لتحسين العمليات.',
      ],
    },
    {
      heading: 'تغليف التصدير وإمكانية التتبع',
      paragraphs: [
        'يتم ترقيم الألواح النهائية وحمايتها وتجهيزها وتغليفها حسب تسلسل التسليم المتفق عليه. ويمكن تنسيق قوائم التعبئة والملصقات وسجلات الجودة ووثائق الشحن وفقا لعقد المشروع.',
      ],
    },
  ],
}
