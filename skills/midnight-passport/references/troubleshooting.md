# Troubleshooting

Symptom first. Each entry names the cause the code proves and the fix.

## Nothing happens for three minutes, then "Passport did not answer in time"

In order of likelihood:

1. **The origin is not exact.** `origin` must be scheme + host + port with no
   path: `https://midnightpassport.com`, not `https://midnightpassport.com/app`
   and not `https://www.midnightpassport.com`. The client drops every message
   whose `event.origin` differs, so the pop-up's handshake is never seen.
   Diagnose with `passport.on('message', console.log)`: nothing inbound means
   an origin problem.
2. **The Passport in that browser was made on v5.0.** A v5.0 Passport does not
   answer a pop-up profile request; the pop-up shows "An app is waiting for your
   Passport" and the call times out (see the table in `SKILL.md`). Test in the
   in-app browser instead (`listing.md`), or with an older Passport.
3. **The user has not finished setting up.** Passport waits, showing the same
   notice, until they have a name; it does not refuse.
4. **Installed Passport on an iPhone home screen.** `window.open` from a
   standalone iOS web app opens Safari with no `window.opener`; Passport says
   "Passport has no way to send an answer back…". Use the redirect channel
   (`redirect-channel.md`) for phone flows.

## "The browser blocked the Passport window" (`popup-blocked`)

The request was not made during a user gesture: it ran in `useEffect`, on page
load, in a timer, or after other `await`s in the click handler. Call
`requestProfile`/`requestPayment` directly in the click handler, first. If a
blocker still refuses, the user must allow pop-ups for the site.

## "The Passport window was closed before it answered" (`passport-closed`)

The user closed the pop-up (or it navigated away). Nothing was shared or paid.
Leave the button enabled; do not treat it as a decline.

## The passkey prompt was cancelled

The passkey prompt belongs to Passport, not to your page. If the user cancels
it during sign-in, Passport stays on its own screen; your call ends when they
close the window (`passport-closed`) or at the timeout. During a payment,
nothing is signed; your call ends with whatever Passport answers or with the
window closing. Show `message` and let them try again.

## `wallet-unavailable` on every payment

Expected on v5.0 for any Passport made on v5.0: apps cannot request payments
from it (`transactions.md`). For an older Passport it means no session is open
in that browser: sign in to Passport first.

## `ReferenceError: window is not defined` (Next.js, Remix, SSR)

`createPassport` (and so `PassportProvider`) reads `window` when created. Create
it after mount or load the component in the browser only: `nextjs.md`.

## `npm install @midnight-passport/connect` fails with E404

It is not published. Use `scripts/vendor-connect.sh` to build a tarball from a
release, or the workspace alias inside the passport-demo repository.

## The pop-up answered, but the call still timed out

The client that made the request was destroyed mid-exchange. `PassportProvider`
re-creates its client whenever a prop changes identity (an inline `transport`
object, an `origin` computed each render), and a component that calls
`createPassport` in its body makes a new client every render. Create one client
per page and keep it; give the provider stable props.

## The app is blank inside Passport's in-app browser

Your host sends `X-Frame-Options` or a `frame-ancestors` CSP that excludes
Passport. Allow `https://midnightpassport.com` (and your test origins) as a
frame ancestor.

## `not-present` inside a frame

Your page is framed, but not by Passport (a preview pane, another site). Force
the pop-up with `transport: 'popup'` if that frame is expected.

## `network-mismatch` or `invalid-request` on a payment

The recipient must be an unshielded **stagenet** address
(`mn_addr_stagenet1…`). A shielded address (`mn_shield-addr_…`), an account
contract address (64 hex), or a preview/preprod/mainnet address is refused.
`invalid-request` also means another approval sheet is already open.

## The explorer shows nothing for a `txId`

Only a 64-hex hash resolves. A 66-hex value is a submission identifier; show it
as text (`transactions.md`, "Explorer links").

## Dev server works, then silently stops answering

The port moved (another process held it and the dev server slid to the next
one), so the origin changed. Pin the port with `strictPort`. Passport run from
the repository is always `http://localhost:5175`; use `localhost`, not
`127.0.0.1`.

## Passkey not offered, or a different Passport appears

Passkeys belong to one domain. A Passport made on `midnightpassport.com` does
not exist on `midnight-passport-dev.vercel.app` or `localhost:5175`, and vice
versa. Make a test Passport per origin you test against.
