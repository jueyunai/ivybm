# Task 6 Design QA

## Comparison target

- Source visual truth: `references/website-prototype/`
- Committed implementation desktop baseline: `tests/e2e/website-visual.spec.ts-snapshots/en-desktop-home-chromium.png`
- Committed implementation English mobile baseline: `tests/e2e/website-visual.spec.ts-snapshots/en-mobile-home-chromium.png`
- Committed implementation Arabic mobile baseline: `tests/e2e/website-visual.spec.ts-snapshots/ar-mobile-home-chromium.png`
- Source desktop capture: `/private/tmp/ivybm-source-home-desktop-iab.png`
- Implementation desktop capture: `/private/tmp/ivybm-task6-home-desktop-iab.png`
- Desktop comparison: `/private/tmp/ivybm-task6-home-desktop-compare.png`
- Source English mobile capture: `/private/tmp/ivybm-source-home-mobile.png`
- Implementation English mobile capture: `/private/tmp/ivybm-task6-home-mobile-closed-iab.png`
- English mobile comparison: `/private/tmp/ivybm-task6-home-mobile-compare.png`
- Source Arabic mobile capture: `/private/tmp/ivybm-source-home-ar-mobile.png`
- Implementation Arabic mobile capture: `/private/tmp/ivybm-task6-home-ar-mobile-iab.png`
- Arabic mobile comparison: `/private/tmp/ivybm-task6-home-ar-mobile-compare.png`
- Viewports: desktop `1440x900`; mobile `390x844`
- States: English LTR home, Arabic RTL home, mobile menu closed; the English mobile menu open state was also inspected.

## Evidence reviewed

The full-view comparisons cover the same home-page route, locale, viewport, and navigation state. The combined comparison files are local QA artifacts, while the implementation side is reproducible from the committed Playwright baselines above and the source side is reproducible from the committed customer prototype. The hero and header are also the focused comparison region because they contain the most fidelity-sensitive typography, imagery, controls, and responsive behavior. Additional focused crops were not required: the desktop and mobile comparison images render the complete above-the-fold hero at readable scale.

Browser-rendered checks covered English and Arabic navigation, language switching, mobile menu open/close, hero controls, product filtering and specification visibility, contact form validation state, and locale-prefixed links. English renders with `lang=en` and `dir=ltr`; Arabic renders with `lang=ar` and `dir=rtl`. At `390x844`, both locales report no horizontal overflow. The page console contained no runtime exception. The in-app development browser surfaced a hydration diagnostic consistent with its injected browser UI and an LCP eagerness hint; neither reproduced as a functional failure in clean Playwright. Visual snapshots hide the Next.js development portal so development-only badges cannot make the baselines nondeterministic.

## Required fidelity surfaces

- Fonts and typography: heading scale, weight, line-height, wrapping, eyebrow treatment, body hierarchy, and Arabic alignment closely follow the approved prototype at desktop and mobile sizes.
- Spacing and layout rhythm: header height, hero content placement, CTA grouping, carousel controls, section transition, responsive stacking, and RTL mirroring preserve the prototype's composition. No clipped controls or horizontal overflow were found.
- Colors and visual tokens: dark header, blue CTA, white secondary CTA, light-blue eyebrow, and warm hero treatment are internally consistent. The warm fallback palette is intentionally visible because photography is unavailable.
- Image quality and asset fidelity: blocked. The prototype uses full-bleed modern curved-facade photography; the implementation currently uses repository-local generated development placeholder images and a warm fallback treatment. The assets are safe and contain no external hotlinks, but they do not match the source subject, depth, crop, or photographic quality.
- Copy and content: public English and Arabic content is coherent and contains no Demo/Fake labels or placeholder contact details. Content differences from the prototype reflect the seeded CMS copy rather than layout drift.
- Icons and controls: navigation, language, menu, CTA, project, and carousel controls are aligned and functional. The prototype's chat entry is intentionally deferred to the later AI customer-service task and is not represented as working Task 6 functionality.

## Findings

- [P1] Approved architectural photography is missing
  - Location: home hero and CMS-backed product/project/news image surfaces.
  - Evidence: the source comparisons show real curved-aluminum building photography; the implementation comparisons show local development placeholders and a warm fallback field.
  - Impact: this is the dominant visual difference and prevents the website from matching the customer's approved brand presentation for production.
  - Fix: replace development placeholders with customer-owned or explicitly licensed factory, product, and project photography, preserving each measured crop and responsive focal point; then regenerate the visual baselines and repeat this QA.

## Open questions

- The repository does not contain approved brand/factory/project photography. Built-in image generation was attempted but returned HTTP 404, and the prototype's external Unsplash URLs cannot be copied as formal assets. The remaining fix therefore needs an approved asset source.

## Comparison history

1. Initial desktop comparison at `1440x900` found the P1 photography mismatch; navigation, typography, hero geometry, CTA placement, and carousel position were otherwise aligned.
2. English and Arabic mobile comparisons at `390x844` confirmed the same photography blocker while validating responsive stacking, RTL mirroring, control placement, and zero horizontal overflow.
3. No compliant replacement asset was available after the image-generation failure, so the P1 remains open. No further code-only iteration can resolve the missing source photography without fabricating or hotlinking an asset.

## Implementation checklist

- Obtain customer-owned or explicitly licensed architectural/factory/product/project photography.
- Replace all development placeholder imagery while preserving the approved crops and focal points.
- Re-run English and Arabic desktop/tablet/mobile screenshots and visual regression tests.
- Repeat Design QA and change the final result only after the P1 is resolved.

## Follow-up polish

- Recheck Arabic line wrapping after final photography changes because crop contrast may affect readable text placement.
- Add the persistent customer-service entry when the later AI customer-service task supplies its real behavior.

final result: blocked
