# Passport surface refresh

2026/09/22. Visual-only branch `codex/send-receive-assets-apps`.

The Send and Receive sheets, Assets tab, and Apps tab now share a small family of cobalt ceramic illustrations. They use the existing Midnight blue and light/dark tokens; no authentication, transfer, name-resolution, QR-generation, registry, or account logic changes. On phones the art sits beside the heading, while desktop screens give it more air. The receive QR remains black on white in both themes.

## Asset set

| Surface | File | Subject |
| --- | --- | --- |
| Send | `examples/passport-demo/public/passport-send.webp` | Passport card with an outward ribbon |
| Receive | `examples/passport-demo/public/passport-receive.webp` | Passport card with an inward ribbon |
| Assets | `examples/passport-demo/public/passport-assets.webp` | Token and faceted item in a tray |
| Apps | `examples/passport-demo/public/passport-apps.webp` | Four-tile portal |

The assets are generated at 1254 × 1254 pixels with genuine transparency, then optimised to 58–67 KB WebP files for the app. They are decorative, with empty alt text; the actual app data and actions remain accessible text and controls.

Generation prompt shared across the set: “Production UI illustration for Midnight Passport. Match the supplied blue ceramic reference only in material, lighting, palette, and premium minimal 3D style. A single cobalt/electric-blue matte ceramic object with smooth precise edges and cool fine highlights, crisp silhouette, floating alone on genuine transparent alpha. Centre composition with generous safe padding. Read on white and near-black. No text, logos, letters, people, particles, stars, shields, checkmarks, coins, noisy gradients, background, fake shadows, or UI.” Each subject in the table was appended as a separate prompt. The reference was a prior recovery-screen asset from the separate design branch; these four files are original new generations.

## Layout intent

- Send: asset, recipient, and amount retain their order and validation, with a clearer title and breathing room. On short phone screens the primary action stays visible as the form scrolls.
- Receive: the QR is the visual centre. Name and account each have their own copy control beneath it.
- Assets: balances remain scannable rows; the illustration is a hero accent, not a fake asset or balance.
- Apps: the hero uses the same visual language, while registry cards retain their own app identity rather than adopting an invented logo.
- Motion is a single gentle arrival for decorative art and is disabled by `prefers-reduced-motion`.

Verification: TypeScript and Vite build passed. The existing mocked passkey walkthrough passed with the real Home, Send, Receive, Assets, and Apps surfaces at 420 px and 1440 px, plus dark mode and 320 px overflow checks. The generated image files are the source assets, not screenshots of a fixture.
