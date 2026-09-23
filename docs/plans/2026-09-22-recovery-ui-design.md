# Recovery screen polish

2026/09/22 — isolated presentation change on `codex/recovery-ui-polish`.

## Scope and handoff

Only the optional recovery setup screen changes. `RecoveryStep.tsx` receives the
same callbacks, busy label, and error from `CustodyPassport.tsx`. No account keys,
provider linking, signing, storage, routing, or transaction behaviour changes.
Apply the single UI commit or its binary Git patch to a checkout containing the
recovery step. Do not merge the entire branch solely to acquire the visual change.

## Design

An open two-column desktop composition pairs one blue Passport/return-arrow asset
with the recovery controls. Phones put a compact illustration above the content.
The title no longer has a forced line break. The provider list sits outside the
short “Add recovery” button. Notices have their own spacing. “Not now” and the
existing failure-state continuation remain available; busy states disable both.

Use existing theme tokens: white/near-black surfaces, blue primary action, muted
copy, and hairline borders. Existing Inter display/body typography is retained.
42px desktop / 30px phone heading, 16–17px body, 13px supporting copy. Spacing:
12px within an action group, 24–32px between groups, 64px desktop column gap.
The illustration has a one-time entrance only, disabled for reduced motion.

The generated concept was a layout reference, not shipped UI. Intentional
differences: retain the exact official wordmark, existing theme blue, and genuine
backend error sentence; show “Continue to my Passport” after failure. Remove the
redundant eyebrow and demo footer on this screen only. No success badge is drawn
before recovery has actually succeeded.

## Generated asset

`examples/passport-demo/public/passport-recovery.png`: 1254 × 1254 RGBA,
transparent, suitable for both themes. Generated with the built-in image tool.

Prompt: “Use case: stylized-concept. Create a production UI illustration for
Midnight Passport's optional account recovery setup. A clean sculptural
electric-blue (#0000FE) passport card with rounded corners, slightly tilted in
three-quarter view, with two subtle abstract horizontal engraved lines; a single
smooth return-loop arrow curves behind the card and emerges beside it,
communicating a way back to the same identity. Minimal premium 3D product
illustration, matte blue ceramic with restrained soft edge highlights, crisp
silhouette, simple geometry. No particles, clouds, gradients as backgrounds,
sparkles, badges, checkmarks, text, lettering, logos, coins, padlocks, shields,
hands, additional cards, or floating objects. It must not imply recovery is
already enabled. Square composition, object occupies centre 72%, generous clean
padding on every side. Genuine transparent alpha background, not a checkerboard
rendered into the image. Blue material with cool pale edge highlights visible on
both pure white and near-black UI backgrounds. Editorial, calm, precise, not
cartoonish. Asset only, no UI mockup.”

## Verification

- TypeScript check passes. ESLint reports no errors (existing console warnings
  in `CustodyPassport.tsx` remain).
- All 39 recovery-state unit tests pass.
- Three mocked Chromium recovery flows pass: skip to Home, already-enabled
  recovery, and failure with continuation. Responsive checks cover 320, 390,
  768, and 1440px in both themes, including horizontal overflow and touch targets.
- In-app browser inspection covers desktop light mode, mobile dark mode,
  the error notice, and both action handlers. The rendered composition retains
  the concept's two-column layout, concise copy, single blue illustration,
  open spacing, bold heading, and understated supporting text.
- Live provider linking, signing, and network transactions were not exercised.
  The UI test bundle builds; the full production preparation needs local proving
  keys that are not staged here. WebKit is not verified on this machine.
