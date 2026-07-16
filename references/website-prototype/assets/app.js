const IMG = {
  hero1: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1800&q=82",
  hero2: "https://images.unsplash.com/photo-1511818966892-d7d671e672a2?auto=format&fit=crop&w=1800&q=82",
  hero3: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1800&q=82",
  factory: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1800&q=82",
  panel: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=82",
  airport: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=82",
  landmark: "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=82",
  workshop: "https://images.unsplash.com/photo-1565043589221-1a6fd9ae45c7?auto=format&fit=crop&w=1200&q=82",
};

const dict = {
  en: {
    dir: "ltr",
    nav: ["Home", "About Us", "Products", "Projects", "News", "Contact"],
    quote: "Get a Quote",
    whatsapp: "WhatsApp",
    heroTitle: "Professional Curved Aluminum Panel Manufacturer",
    heroSub: "Source factory for double-curved, single-curved, and custom facade aluminum panel solutions.",
    heroKicker: "IVYBM Building Materials",
    heroCaption: "Factory-direct aluminum facade panels for commercial complexes, airports, landmarks, and custom building envelopes.",
    learn: "Learn More",
    view: "View Case",
    allProjects: "View All Projects",
    valuesTitle: "Source Factory Capability For Complex Facade Panels",
    valuesSub: "IVYBM supports overseas contractors, curtain wall consultants, and project purchasers from design coordination through production inspection and export delivery.",
    productsTitle: "Product Categories",
    projectsTitle: "Featured Projects",
    contactTitle: "Send Your Project Inquiry",
    contactSub: "Share drawings, quantities, surface finish requirements, or target delivery schedule. Our team will respond within 24 hours.",
    footerIntro: "IVYBM supplies curved and custom aluminum panels for overseas curtain wall projects, with engineering coordination, quality inspection, and export support.",
    success: "Thank you! We will contact you within 24 hours.",
    required: "This field is required.",
    invalidEmail: "Please enter a valid email address.",
  },
  ar: {
    dir: "rtl",
    nav: ["الرئيسية", "من نحن", "المنتجات", "المشاريع", "الأخبار", "اتصل بنا"],
    quote: "اطلب عرض سعر",
    whatsapp: "واتساب",
    heroTitle: "مصنع محترف لألواح الألمنيوم المنحنية",
    heroSub: "مصدر مباشر لألواح الواجهات مزدوجة الانحناء وأحادية الانحناء والحلول المخصصة.",
    heroKicker: "IVYBM لمواد البناء",
    heroCaption: "ألواح ألمنيوم للواجهات التجارية والمطارات والمباني المميزة ومشاريع الواجهات الخاصة.",
    learn: "اعرف المزيد",
    view: "عرض الحالة",
    allProjects: "كل المشاريع",
    valuesTitle: "قدرة مصنع مصدر لألواح الواجهات المعقدة",
    valuesSub: "تدعم IVYBM المقاولين والاستشاريين ومشتري المشاريع من تنسيق التصميم حتى فحص الجودة والتصدير.",
    productsTitle: "فئات المنتجات",
    projectsTitle: "مشاريع مختارة",
    contactTitle: "أرسل استفسار مشروعك",
    contactSub: "شارك الرسومات والكميات ومتطلبات التشطيب أو جدول التسليم المستهدف. سنرد خلال 24 ساعة.",
    footerIntro: "توفر IVYBM ألواح ألمنيوم منحنية ومخصصة لمشاريع الواجهات الخارجية مع دعم هندسي وفحص جودة وتصدير.",
    success: "شكرًا لك! سنتواصل معك خلال 24 ساعة.",
    required: "هذا الحقل مطلوب.",
    invalidEmail: "يرجى إدخال بريد إلكتروني صحيح.",
  },
};

const routes = [
  ["/", "Home"],
  ["/about", "About Us"],
  ["/products", "Products"],
  ["/projects", "Projects"],
  ["/news", "News"],
  ["/contact", "Contact"],
];

const values = [
  ["factory", "Source Factory Direct", "Direct manufacturing support for aluminum panels, drawings, samples, and project-specific production control."],
  ["settings", "Custom Fabrication", "Double-curved, single-curved, perforated, folded, and special-shaped panels matched to facade design intent."],
  ["ship", "Global Delivery", "Export packing, logistics coordination, and documentation support for Middle East, Africa, Central Asia, and beyond."],
  ["badge-check", "Quality Certified", "Inspection-ready production process covering material, dimensions, color, coating, packing, VMU, and PMU samples."],
];

const products = [
  {
    type: "double",
    title: "Double-Curved Aluminum Panel",
    zh: "双曲铝单板",
    img: IMG.hero3,
    desc: "For landmark facades, complex geometry, flowing surfaces, atriums, and high-precision architectural skins.",
    specs: [["Thickness", "2.0 / 2.5 / 3.0 / 4.0 mm"], ["Material", "AA3003 / AA5005 aluminum alloy"], ["Surface", "PVDF, powder coating, anodized, wood grain"], ["Process", "3D forming, welding, grinding, CNC calibration"]],
  },
  {
    type: "single",
    title: "Single-Curved Aluminum Panel",
    zh: "单曲弧形铝单板",
    img: IMG.airport,
    desc: "For airport roofs, canopies, column wraps, curved corridor walls, and arc-shaped facade zones.",
    specs: [["Thickness", "2.0 / 2.5 / 3.0 mm"], ["Radius", "Custom bending radius by shop drawing"], ["Finish", "PVDF / powder coating / metallic color"], ["Use", "Roof, soffit, canopy, facade curve"]],
  },
  {
    type: "standard",
    title: "Standard Facade Aluminum Panel",
    zh: "常规幕墙铝单板",
    img: IMG.panel,
    desc: "For curtain wall cladding, exterior walls, ceilings, parapets, lobbies, and durable decorative systems.",
    specs: [["Thickness", "1.5 / 2.0 / 2.5 / 3.0 mm"], ["Max size", "Custom size subject to engineering review"], ["Color", "RAL, Pantone, metallic, stone texture"], ["Installation", "Ribbed, bracketed, cassette panel systems"]],
  },
];

const projects = [
  ["Commercial Complex Facade", "Dubai, UAE", "Double-curved panels", IMG.hero1],
  ["Airport Terminal Roof", "Central Asia", "Single-curved panels", IMG.airport],
  ["Landmark Curtain Wall", "Abu Dhabi, UAE", "Custom-shaped panels", IMG.hero3],
  ["Factory Production Support", "China", "VMU/PMU samples", IMG.factory],
  ["Hotel Podium Cladding", "Riyadh, Saudi Arabia", "PVDF facade panels", IMG.landmark],
  ["Public Building Canopy", "Doha, Qatar", "Perforated aluminum panels", IMG.workshop],
];

const news = [
  ["How Double-Curved Aluminum Panels Support Landmark Facade Design", "Technical Articles", "2026-06-18", "Key considerations for 3D geometry, forming accuracy, shop drawings, and surface consistency."],
  ["PVDF Coating Checks For Overseas Curtain Wall Projects", "Industry Trends", "2026-06-10", "A practical inspection checklist for coating thickness, color difference, adhesion, and packing protection."],
  ["IVYBM Expands Export Support For Middle East Contractors", "Company News", "2026-05-28", "Improved documentation, sample workflow, and production reporting for overseas facade procurement teams."],
];

function t() {
  return dict[localStorage.getItem("ivybmLang") || "en"];
}

function path() {
  const p = window.location.pathname.replace(/\/$/, "") || "/";
  return routes.some(([href]) => href === p) ? p : "/";
}

function navigate(href) {
  window.history.pushState({}, "", href);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function icon(name, size = 20) {
  return `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
}

function header() {
  const lang = localStorage.getItem("ivybmLang") || "en";
  const d = t();
  return `
    <header class="site-header">
      <nav class="nav" aria-label="Main navigation">
        <a class="brand" href="/" data-link>
          <span class="brand-mark">IVY</span>
          <span>IVYBM</span>
        </a>
        <div class="nav-links" id="navLinks">
          ${routes.map(([href], i) => `<a href="${href}" data-link class="${path() === href ? "active" : ""}">${d.nav[i]}</a>`).join("")}
        </div>
        <div class="nav-actions">
          <select class="lang-select" id="langSelect" aria-label="Language">
            <option value="en" ${lang === "en" ? "selected" : ""}>EN</option>
            <option value="ar" ${lang === "ar" ? "selected" : ""}>AR</option>
          </select>
          <a class="icon-btn" href="https://wa.me/8613800000000" aria-label="${d.whatsapp}" title="${d.whatsapp}">${icon("message-circle")}</a>
          <a class="btn" href="/contact" data-link>${icon("send")} ${d.quote}</a>
          <button class="menu-btn" id="menuBtn" aria-label="Menu">${icon("menu")}</button>
        </div>
      </nav>
    </header>
  `;
}

function footer() {
  const d = t();
  return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <a class="brand" href="/" data-link><span class="brand-mark">IVY</span><span>IVYBM</span></a>
            <p>${d.footerIntro}</p>
          </div>
          <div>
            <h3>Quick Links</h3>
            <div class="footer-links">${routes.map(([href], i) => `<a href="${href}" data-link>${d.nav[i]}</a>`).join("")}</div>
          </div>
          <div>
            <h3>Contact</h3>
            <p>Email: sales@ivybm.com<br />WhatsApp: +86 138 0000 0000<br />Factory: Foshan, Guangdong, China</p>
          </div>
        </div>
        <div class="copyright">© ${new Date().getFullYear()} IVYBM. All rights reserved. Demo images are used for website preview and should be replaced with owned project photos before launch.</div>
      </div>
    </footer>
  `;
}

function sectionHead(kicker, title, sub, action = "") {
  return `
    <div class="section-head">
      <div>
        <div class="section-kicker">${kicker}</div>
        <h2>${title}</h2>
        ${sub ? `<p class="muted">${sub}</p>` : ""}
      </div>
      ${action}
    </div>
  `;
}

function productCard(product, details = false) {
  const d = t();
  return `
    <article class="product-card" data-type="${product.type}">
      <img src="${product.img}" alt="${product.title}" loading="lazy" />
      <div class="card-body">
        <h3>${product.title}</h3>
        <p class="muted">${product.zh}</p>
        <p class="muted">${product.desc}</p>
        ${details ? specTable(product.specs) : ""}
        <a class="text-link" href="/contact?product=${encodeURIComponent(product.title)}" data-link>${d.quote} ${icon("arrow-right", 17)}</a>
      </div>
    </article>
  `;
}

function specTable(rows) {
  return `<table class="spec-table">${rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join("")}</table>`;
}

function home() {
  const d = t();
  return `
    <section class="hero">
      ${[IMG.hero1, IMG.hero2, IMG.hero3, IMG.factory].map((src, i) => `<div class="hero-slide ${i === 0 ? "active" : ""}"><img src="${src}" alt="IVYBM project visual ${i + 1}" /></div>`).join("")}
      <div class="hero-content">
        <div class="eyebrow">${d.heroKicker}</div>
        <h1>${d.heroTitle}</h1>
        <p class="lead">${d.heroSub}</p>
        <div class="hero-actions">
          <a class="btn" href="/contact" data-link>${icon("send")} ${d.quote}</a>
          <a class="btn secondary" href="/projects" data-link>${icon("building-2")} ${d.allProjects}</a>
        </div>
      </div>
      <div class="hero-controls">
        <div class="hero-caption">${d.heroCaption}</div>
        <div class="slide-buttons">
          <button class="icon-btn" id="prevSlide" aria-label="Previous">${icon("chevron-left")}</button>
          <button class="icon-btn" id="nextSlide" aria-label="Next">${icon("chevron-right")}</button>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="container">
        ${sectionHead("Factory Advantages", d.valuesTitle, d.valuesSub)}
        <div class="grid cols-4">${values.map(([ic, title, desc]) => `<article class="value-card">${icon(ic, 30)}<h3>${title}</h3><p class="muted">${desc}</p></article>`).join("")}</div>
      </div>
    </section>
    <section class="section alt">
      <div class="container">
        ${sectionHead("Products", d.productsTitle, "Core facade panel systems for complex overseas construction projects.")}
        <div class="grid cols-3">${products.map((p) => productCard(p)).join("")}</div>
      </div>
    </section>
    <section class="section">
      <div class="container">
        ${sectionHead("Projects", d.projectsTitle, "Representative applications across commercial, airport, landmark, and public building envelopes.", `<a class="btn ghost" href="/projects" data-link>${d.allProjects}</a>`)}
        <div class="grid cols-3">${projects.slice(0, 6).map(projectCard).join("")}</div>
      </div>
    </section>
  `;
}

function projectCard(project) {
  const d = t();
  return `<article class="project-card"><img src="${project[3]}" alt="${project[0]}" loading="lazy" /><div class="card-body"><h3>${project[0]}</h3><p class="muted">${project[1]}<br />${project[2]}</p><a class="text-link" href="/contact" data-link>${d.view} ${icon("arrow-right", 17)}</a></div></article>`;
}

function pageHero(title, sub) {
  return `<section class="page-hero"><div class="container"><div class="eyebrow">IVYBM</div><h1>${title}</h1><p class="lead">${sub}</p></div></section>`;
}

function about() {
  return `
    ${pageHero("About IVYBM", "A source factory partner for curved and custom aluminum panel projects.")}
    <section class="section">
      <div class="container grid cols-2">
        <div>
          <div class="section-kicker">Factory Profile</div>
          <h2>Built For Overseas Curtain Wall Procurement</h2>
          <p class="muted">IVYBM focuses on double-curved, single-curved, and special-shaped aluminum panels for commercial buildings, airports, public architecture, and landmark facade projects.</p>
          <p class="muted">We support project teams through drawing coordination, VMU/PMU sample preparation, dimensional inspection, surface finish control, export packing, and shipping documentation.</p>
          <div class="stats">
            <div class="stat"><strong>10+</strong><span>Years facade supply experience</span></div>
            <div class="stat"><strong>120+</strong><span>Project batches supported</span></div>
            <div class="stat"><strong>20+</strong><span>Export markets served</span></div>
          </div>
        </div>
        <div class="grid cols-2">
          ${[IMG.factory, IMG.workshop, IMG.panel, IMG.hero3].map((src) => `<img src="${src}" alt="IVYBM factory and facade capability" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px" loading="lazy" />`).join("")}
        </div>
      </div>
    </section>
    <section class="section feature-band"><div class="container">${sectionHead("Quality Process", "Inspection-ready production control", "Material certificates, dimensional checks, coating inspection, color confirmation, trial assembly review, packing protection, and shipment documentation can be coordinated according to project requirements.", `<a class="btn" href="/contact" data-link>Contact Us</a>`)}</div></section>
  `;
}

function productsPage() {
  return `
    ${pageHero("Products", "Evaluate curved, custom, and standard aluminum facade panel systems for your project.")}
    <section class="section">
      <div class="container">
        <div class="tabs" id="productTabs">
          <button class="tab active" data-filter="all">All</button>
          <button class="tab" data-filter="double">Double-Curved</button>
          <button class="tab" data-filter="single">Single-Curved</button>
          <button class="tab" data-filter="standard">Standard Facade</button>
        </div>
        <div class="grid cols-3" id="productGrid">${products.map((p) => productCard(p, true)).join("")}</div>
      </div>
    </section>
  `;
}

function projectsPage() {
  return `
    ${pageHero("Projects", "Project references that show factory capability, engineering coordination, and facade delivery experience.")}
    <section class="section">
      <div class="container">
        <div class="tabs"><button class="tab active">All Projects</button><button class="tab">International</button><button class="tab">Commercial</button><button class="tab">Airport</button><button class="tab">Landmark</button></div>
        <div class="grid cols-3">${projects.map(projectCard).join("")}</div>
      </div>
    </section>
  `;
}

function newsPage() {
  return `
    ${pageHero("News", "Industry notes, technical articles, and company updates for aluminum facade procurement.")}
    <section class="section">
      <div class="container">
        <div class="tabs"><button class="tab active">All</button><button class="tab">Industry Trends</button><button class="tab">Company News</button><button class="tab">Technical Articles</button></div>
        <div class="grid cols-3">
          ${news.map((n, i) => `<article class="news-card"><img src="${[IMG.panel, IMG.factory, IMG.hero1][i]}" alt="${n[0]}" loading="lazy" /><div class="card-body"><p class="section-kicker">${n[1]} · ${n[2]}</p><h3>${n[0]}</h3><p class="muted">${n[3]}</p><a class="text-link" href="/contact" data-link>Contact Us for More Information ${icon("arrow-right", 17)}</a></div></article>`).join("")}
        </div>
      </div>
    </section>
  `;
}

function contactPage() {
  const d = t();
  const product = new URLSearchParams(location.search).get("product") || "";
  return `
    ${pageHero("Contact IVYBM", d.contactSub)}
    <section class="section alt">
      <div class="container contact-wrap">
        <div class="grid">
          <article class="info-card">${icon("map-pin", 28)}<h3>Factory Location</h3><p class="muted">Foshan, Guangdong, China<br />Export support for Middle East, Africa, Central Asia, Europe, America, and Australia.</p></article>
          <article class="info-card">${icon("mail", 28)}<h3>Email</h3><p class="muted"><a href="mailto:sales@ivybm.com">sales@ivybm.com</a></p></article>
          <article class="info-card">${icon("clock", 28)}<h3>Working Hours</h3><p class="muted">Monday - Saturday<br />09:00 - 18:00 China Standard Time</p></article>
        </div>
        <form class="form" id="inquiryForm" novalidate>
          <h2>${d.contactTitle}</h2>
          <p class="muted">${d.contactSub}</p>
          <div class="form-grid">
            ${field("name", "Name *", "text")}
            ${field("email", "Email *", "email")}
            ${field("company", "Company", "text", false)}
            ${selectField("country", "Country *", ["United Arab Emirates", "Saudi Arabia", "Qatar", "Oman", "Kuwait", "United States", "Australia", "Other"])}
            ${selectField("interest", "Product Interest", ["Double-Curved Aluminum Panel", "Single-Curved Aluminum Panel", "Standard Facade Aluminum Panel", "Other"], false, product)}
            ${field("message", "Message *", "textarea", true, "Please describe drawing status, quantity, surface finish, delivery schedule, and project location.")}
          </div>
          <button class="btn" type="submit">${icon("send")} Send Inquiry</button>
          <div class="form-status" id="formStatus"></div>
        </form>
      </div>
    </section>
  `;
}

function field(name, label, type, required = true, placeholder = "") {
  const input = type === "textarea"
    ? `<textarea id="${name}" name="${name}" ${required ? "required" : ""} placeholder="${placeholder}"></textarea>`
    : `<input id="${name}" name="${name}" type="${type}" ${required ? "required" : ""} />`;
  return `<div class="field ${type === "textarea" ? "full" : ""}" data-field="${name}"><label for="${name}">${label}</label>${input}<div class="error-text"></div></div>`;
}

function selectField(name, label, options, required = true, selected = "") {
  return `<div class="field" data-field="${name}"><label for="${name}">${label}</label><select id="${name}" name="${name}" ${required ? "required" : ""}><option value="">Select</option>${options.map((o) => `<option ${selected === o ? "selected" : ""}>${o}</option>`).join("")}</select><div class="error-text"></div></div>`;
}

function main() {
  const current = path();
  if (current === "/about") return about();
  if (current === "/products") return productsPage();
  if (current === "/projects") return projectsPage();
  if (current === "/news") return newsPage();
  if (current === "/contact") return contactPage();
  return home();
}

function bind() {
  document.querySelectorAll("[data-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("mailto:")) return;
      event.preventDefault();
      navigate(href);
    });
  });

  document.getElementById("langSelect")?.addEventListener("change", (event) => {
    localStorage.setItem("ivybmLang", event.target.value);
    render();
  });

  document.getElementById("menuBtn")?.addEventListener("click", () => {
    document.getElementById("navLinks")?.classList.toggle("open");
  });

  bindHero();
  bindProducts();
  bindForm();
  if (window.lucide) window.lucide.createIcons();
}

function bindHero() {
  const slides = [...document.querySelectorAll(".hero-slide")];
  if (!slides.length) return;
  let index = 0;
  const show = (next) => {
    slides[index].classList.remove("active");
    index = (next + slides.length) % slides.length;
    slides[index].classList.add("active");
  };
  document.getElementById("prevSlide")?.addEventListener("click", () => show(index - 1));
  document.getElementById("nextSlide")?.addEventListener("click", () => show(index + 1));
  setInterval(() => show(index + 1), 5000);
}

function bindProducts() {
  document.querySelectorAll("#productTabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#productTabs .tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const filter = tab.dataset.filter;
      document.querySelectorAll("#productGrid .product-card").forEach((card) => {
        card.style.display = filter === "all" || card.dataset.type === filter ? "" : "none";
      });
    });
  });
}

function bindForm() {
  const form = document.getElementById("inquiryForm");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const d = t();
    let valid = true;
    form.querySelectorAll(".field").forEach((wrap) => {
      const input = wrap.querySelector("input,select,textarea");
      const error = wrap.querySelector(".error-text");
      let message = "";
      if (input.required && !input.value.trim()) message = d.required;
      if (input.type === "email" && input.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) message = d.invalidEmail;
      wrap.classList.toggle("error", Boolean(message));
      error.textContent = message;
      if (message) valid = false;
    });
    if (!valid) return;
    const status = document.getElementById("formStatus");
    status.textContent = "Sending...";
    setTimeout(() => {
      status.textContent = d.success;
      form.reset();
    }, 700);
  });
}

function render() {
  const d = t();
  document.documentElement.lang = localStorage.getItem("ivybmLang") || "en";
  document.body.dir = d.dir;
  document.getElementById("app").innerHTML = `${header()}<main>${main()}</main>${footer()}`;
  bind();
}

window.addEventListener("popstate", render);
render();
