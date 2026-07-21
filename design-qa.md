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
- Colors and visual tokens: dark header, blue CTA, white secondary CTA, light-blue eyebrow, image overlays, and text contrast remain internally consistent after replacing the warm fallback images.
- Image quality and asset fidelity: sufficient for customer showcase. Eight prototype-aligned Unsplash images are stored as repository seed inputs, uploaded through Payload, and rendered without external hotlinks. They restore the intended architectural depth and subject variety, but remain temporary showcase assets rather than customer-approved long-term brand photography.
- Copy and content: public English and Arabic content is coherent and contains no Demo/Fake labels or placeholder contact details. Content differences from the prototype reflect the seeded CMS copy rather than layout drift.
- Icons and controls: navigation, language, menu, CTA, project, and carousel controls are aligned and functional. The prototype's chat entry is intentionally deferred to the later AI customer-service task and is not represented as working Task 6 functionality.

## Findings

- [P1] Customer-approved long-term architectural photography is still missing
  - Location: home hero and CMS-backed product/project/news image surfaces.
  - Evidence: the source and refreshed implementation baselines now show prototype-aligned architecture imagery; the implementation assets are still recorded as temporary Unsplash showcase material rather than customer-owned brand photography.
  - Impact: no longer blocks customer demonstration, but still blocks final production asset acceptance and long-term brand ownership confirmation.
  - Fix: replace the temporary showcase assets with customer-owned or explicitly approved factory, product, and project photography, preserving each measured crop and responsive focal point; then regenerate the visual baselines and repeat this QA.

## Open questions

- The repository now contains locally stored temporary showcase copies of the prototype's Unsplash images, with source URLs and SHA-256 values recorded in `docs/assets/客户演示素材来源.md`. The customer still needs to confirm the final long-term production assets.

## Comparison history

1. Initial desktop comparison at `1440x900` found the P1 photography mismatch; navigation, typography, hero geometry, CTA placement, and carousel position were otherwise aligned.
2. English and Arabic mobile comparisons at `390x844` confirmed the same photography blocker while validating responsive stacking, RTL mirroring, control placement, and zero horizontal overflow.
3. The customer authorized the prototype images for an online showcase. Eight images were committed as deterministic seed inputs, all 36 visual baselines were regenerated, and visual tests were updated to wait for lazy-loaded images before capture.
4. Desktop and mobile spot checks confirm real images across Hero, product, project, News, and Contact surfaces in English and Arabic. The remaining P1 is limited to final production ownership / approval, not showcase fidelity.

## Implementation checklist

- Obtain customer-owned or explicitly approved long-term architectural/factory/product/project photography before final production acceptance.
- Replace the temporary showcase imagery while preserving the approved crops and focal points.
- Re-run English and Arabic desktop/tablet/mobile screenshots and visual regression tests after the final asset replacement.
- Repeat Design QA before marking the production asset P1 resolved.

## Follow-up polish

- Recheck Arabic line wrapping after final photography changes because crop contrast may affect readable text placement.
- Add the persistent customer-service entry when the later AI customer-service task supplies its real behavior.

final result: passed for customer showcase; blocked for final production asset acceptance
