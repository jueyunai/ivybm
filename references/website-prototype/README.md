# IVYBM Website Preview

This is a first working version of the IVYBM foreign trade showcase website for curved aluminum facade panels.

## Production UI Acceptance Baseline

This customer-provided prototype is the approved UI and interaction acceptance baseline for the production website, not an optional visual reference. The formal Next.js / Payload implementation must reproduce its visual hierarchy, layout, colors, typography, spacing, component states, navigation, carousel, filtering, form interactions, responsive behavior, English LTR presentation, and Arabic RTL presentation with high fidelity.

The production implementation may replace only the prototype's placeholder contact details, external demo images, sample content, simulated form submission, and client-only routing or data logic with approved assets, CMS content, locale-prefixed SEO routes, server-side rendering, and persistent backend workflows. Any intentional visual or interaction change requires customer confirmation.

## Run Locally

```powershell
node server.mjs
```

Open:

```text
http://localhost:4173
```

Supported preview routes:

- `/`
- `/about`
- `/products`
- `/projects`
- `/news`
- `/contact`

## Included

- English and Arabic language switch with RTL layout support
- Home page with hero carousel, factory advantages, product categories, and featured projects
- About, Products, Projects, News, and Contact pages
- Product filtering and specification tables
- Inquiry form validation and success message
- Responsive desktop, tablet, and mobile layout

## Before Public Launch

- Replace demo images with owned IVYBM factory, production, product, and project photos
- Replace placeholder contact details with official email, address, and social links; any retained WhatsApp link is a static external contact link only, not a phase-one system integration
- Connect the inquiry form to an email, CRM, database, or backend API
- Add final certifications, project names, product parameters, and downloadable PDF catalog files
