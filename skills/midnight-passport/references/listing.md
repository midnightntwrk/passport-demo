# The in-app browser, local testing, and getting listed

On v5.0 the in-app browser is the channel every Passport answers for a
profile, so it is the path to test first.

## How the in-app browser works

Passport's Apps grid opens an app's `https` URL in a frame. The package detects
the frame (`window.parent !== window`) and switches to the iframe transport by
itself; the same code runs framed and standalone. Framed:

- Passport posts `passport.profile.ready`; `passport.ready()` resolves.
- `requestProfile` needs no click (no pop-up), though asking on a press is
  still better manners.
- The consent sheet shows **one toggle per requested field, all off**. The
  user shares some, all, or none. Nothing ticked is answered
  `profile_unavailable`.
- `reportIncentive` works here and only here.

Your host must allow framing: no `X-Frame-Options`, and no `frame-ancestors`
CSP that excludes the Passport origin.

Framed, your app is a cross-site iframe. A session cookie you set there needs
`SameSite=None; Secure` (and browsers that partition or block third-party
cookies may still drop it), so keep sign-in state that must survive in the
frame in memory or `sessionStorage`, or re-ask with `requestProfile`.

## Testing framed, locally

Run Passport from the repository with your app added to its grid:

```sh
git clone https://github.com/midnightntwrk/passport-demo && cd passport-demo
npm install
VITE_LOCAL_APP_URL=http://localhost:5190 VITE_LOCAL_APP_NAME="My app" npm run passport:demo
```

Open `http://localhost:5175`, make a Passport, open Apps, and press your entry
(it is featured at the top). Your app's `VITE_PASSPORT_ORIGIN` must then be
`http://localhost:5175`. The entry is added to the fetched registry, not
swapped in for it. Restart Passport after changing a `VITE_*` value.

Framed testing against a deployed Passport needs your app on public `https`
and listed.

## Getting listed

The Apps grid reads the 1AM app registry at runtime (ten-minute cache):
`https://raw.githubusercontent.com/webisoftSoftware/1AM-app-registery/main/registry.json`.
Listing is a pull request to https://github.com/webisoftSoftware/1AM-app-registery
adding one entry to `apps`; its CI runs `validate.js`, which is the authority
on the schema. Run `node validate.js` locally first (no install). As of
2026/09/28 it requires `id` (lowercase, digits, hyphens, at most 32),
`name` (at most 40), `description` (at most 120), an `https` `icon` (at most
50 KB), an `https` `url`, `category` (`defi`, `tools`, `gaming`, `social`,
`nft`, `identity`, `other`), and a non-empty `networks` list from `preview`,
`preprod`, `mainnet`, or `*`.

Note the mismatch: the validator does not accept `stagenet`, while Passport
itself runs on stagenet and its parser keeps a `stagenet` entry. Say so in the
pull request rather than guessing a value; the registry maintainers decide.

A listing is not an audit and grants nothing: the consent and approval sheets
apply to every app, listed or not. Never set `featured`; maintainers do.
