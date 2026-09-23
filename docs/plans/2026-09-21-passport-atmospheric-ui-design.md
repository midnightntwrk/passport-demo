# Passport UI design

**Date:** 2026/09/21  
**Status:** Implemented on `codex/modern-passkey-ui`; ported onto the account
custody flow on `feat/ui-port` (2026/09/22)

**Reference correction:** 2026/09/22 — the supplied screenshots supersede the
atmospheric direction for every screen after login. Keep the approved login;
restore the clean product interface rather than extending its hero treatment.

## Intent

Refresh the Passport demo into a richer, calmer product experience without changing its custody, WebAuthn, or Dynamic authentication behaviour. The interface should feel unmistakably Midnight: precise, private, atmospheric, and confident in both light and dark appearance modes.

## Brand system

- Use Midnight Black (`#0A0A0A`), White (`#FFFFFF`), and Midnight Blue (`#0000FE`) as the primary palette from the Midnight brand hub.
- Keep Outfit on the approved login; use the reference's system sans-serif stack on product screens.
- Retain the official Midnight wordmark and symbol already shipped with the app.
- Treat violet as a subordinate atmospheric highlight; cobalt remains the recognisable brand anchor.
- The entry illustration is a vector credential in Midnight Blue with the official symbol, concealed fields, and a lock. Its small proof badge inherits the active theme. The earlier eclipse assets have been removed.

## Experience

The entry screen leads with a simple animated credential, a compact brand bar, and one clear promise: “Your private identity for the Midnight network.” A verification proof rests beside the credential; its fields remain concealed. This illustration communicates selective sharing and is decorative, not a real verification status. Continue with Passkey is the one primary action and still creates or signs in; its hint, "Use a different passkey", and "I already have a Passport" (where the build offers that road) sit beneath it. There is no provider sign-in button on the entry screen: a provider sign-in only opens a Passport that already exists.

At desktop widths of 960px and above, the introduction and enlarged illustration sit beside a dedicated sign-in panel. Smaller screens retain the stacked layout. The primary action has an inset icon tile and short supporting copy, and uses solid Midnight Blue. The artwork's backing, proof badge, borders, and text follow the selected theme.

After login, use plain white or Midnight Black backgrounds, bold headings,
neutral grey panels, and solid blue actions. Home leads with the time-of-day
greeting and the holder's name. Balances stay in aligned rows. The floating
navigation uses a solid blue active segment with white icon and label.

Welcome, name selection, and registration progress retain the screenshot's
single-column structure, pill-shaped name field, visible progress stages,
and optional waiting game. Send and Receive remain centred dialogs on desktop
and reachable sheets on mobile; tall content scrolls inside the dialog.
Native passkey prompts and all authentication/transaction logic remain intact.

Reference ledger: restore the greeting, remove the background eclipse and
product gradients, return neutral token icons and cards, restore bold type
and uppercase navigation labels, and remove duplicate CSS overrides. Retain
official Midnight Blue (`#0000FE`) rather than sampling the older reference's
brighter blue. Apps retains its wider
720px desktop discovery column; Home and Assets use 560px, onboarding 520px.

## Motion and accessibility

- Onboarding uses a brief staggered opacity and ten-pixel rise: brand bar, illustration, message, then sign-in panel. This starts as the existing splash fades, without extending its duration, and completes within 770ms. Reduced motion removes this entrance sequence.
- The credential moves by four pixels over an eight-second cycle; the verification proof stays visible and still. Reduced motion leaves the credential still.
- `prefers-reduced-motion` removes non-essential transitions and staged entrance effects.
- Interactive controls retain visible focus treatment, semantic buttons, status text, and existing accessibility labels.
- Mobile widths, short viewports, and desktop widths use the same content hierarchy without horizontal overflow.

## Scope boundaries

Existing passkey discovery, enrolment, recovery, custody, provider session, and transaction behaviour remain intact.

The atmosphere is scoped to the entry screen (`.mnob-landing`). The account
custody road's welcome, name step, setup progress, "Add a way back" step,
and road home share the onboarding sheet, and take the clean product
treatment described above rather than the entry screen's hero styling.

## Verification

- TypeScript typecheck and production build.
- Focused onboarding and component tests.
- Browser review at mobile and desktop widths in both appearance modes.
- Visual comparison against the accepted onboarding concept and Midnight brand palette.
