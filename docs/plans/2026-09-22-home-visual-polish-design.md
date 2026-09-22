# Passport Home visual polish

**Date:** 2026/09/22  
**Branch:** `codex/home-visual-polish`

## Direction

The current desktop Home repeats a long `.night` name in the greeting and in a large, saturated blue identity card. The card dominates the page while the featured app feels comparatively utilitarian. Keep the actual content and behaviour, but make the hierarchy calmer: greeting first, identity and balances as equally legible peers, then a featured app with a more generous illustrated treatment.

The alternative of keeping a full-bleed blue card would retain strong branding but leave the same visual fatigue. A broad tinted page would compete with account data and dark mode. Instead, use neutral surfaces, one subtle blue wash on the identity card, and Midnight Blue for the symbol, status, and primary action.

## Layout

- The greeting names the time of day only. The `.night` name appears once, in its identity card, where registration status supplies its context.
- The identity card is compact, with a fine blue edge, the official Midnight symbol, and a soft branded corner wash. Its status and name remain real data, not decorative copy.
- The balance panel keeps the existing token table and send/receive actions; no custody or financial state is changed.
- The Home Raffle card gives its existing theme-aware ticket illustration a deliberate visual area, with readable text and a clear open affordance.
- Below 640px the Raffle illustration sits above the text; above that width it sits beside it. All tap targets remain at least 44px and long names wrap safely.

## Scope and verification

Only Home composition and scoped presentation rules change. Auth, name registration, balances, transfers, app opening, and the separate Apps tab retain their behaviour. Review at 375px and desktop widths in light and dark mode, including long names and reduced motion; run typecheck and relevant tests.
