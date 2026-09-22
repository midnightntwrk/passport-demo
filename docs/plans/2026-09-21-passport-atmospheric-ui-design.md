# Passport atmospheric UI design

**Date:** 2026/09/21  
**Status:** Implemented on `codex/modern-passkey-ui`

## Intent

Refresh the Passport demo into a richer, calmer product experience without changing its custody, WebAuthn, or Dynamic authentication behaviour. The interface should feel unmistakably Midnight: precise, private, atmospheric, and confident in both light and dark appearance modes.

## Brand system

- Use Midnight Black (`#0A0A0A`), White (`#FFFFFF`), and Midnight Blue (`#0000FE`) as the primary palette from the Midnight brand hub.
- Use Outfit for display and interface typography.
- Retain the official Midnight wordmark and symbol already shipped with the app.
- Treat violet as a subordinate atmospheric highlight; cobalt remains the recognisable brand anchor.
- The entry illustration is a vector credential in Midnight Blue with the official symbol, concealed fields, and a lock. Its small proof badge inherits the active theme. The earlier eclipse assets remain available for the signed-in background.

## Experience

The entry screen leads with a simple animated credential, a compact brand bar, and one clear promise: “Your private identity for the Midnight network.” Only a verification proof emerges from the credential; its fields remain concealed. This illustration communicates selective sharing and is decorative, not a real verification status. Passkey remains the primary action. Dynamic stays visible as a visually related secondary sign-in path, with an explanatory disabled state while loading or unavailable. A brief privacy reassurance explains the interaction model without adding another decision.

The identity-creation journey carries the same hierarchy, glass-like raised surfaces, and compact motion. The signed-in shell shifts from onboarding to utility: the active Midnight name becomes the hero, Send and Receive become the primary actions, assets are easier to scan, and navigation behaves like a floating dock.

## Motion and accessibility

- Entry motion uses short opacity, translation, blur, and scale transitions with staggered timing.
- The credential moves by four pixels over an eight-second cycle while a verification proof fades into view, rests, and recedes. Reduced motion leaves the credential and proof visible without animation.
- `prefers-reduced-motion` removes non-essential transitions and staged entrance effects.
- Interactive controls retain visible focus treatment, semantic buttons, status text, and existing accessibility labels.
- Mobile widths, short viewports, and desktop widths use the same content hierarchy without horizontal overflow.

## Scope boundaries

Existing passkey discovery, enrolment, recovery, custody, Dynamic session, and transaction behaviour remain intact. The Dynamic button always renders for a signed-out visitor; opening authentication requires a configured, ready Dynamic session.

## Verification

- TypeScript typecheck and production build.
- Focused onboarding and component tests.
- Browser review at mobile and desktop widths in both appearance modes.
- Visual comparison against the accepted onboarding concept and Midnight brand palette.
