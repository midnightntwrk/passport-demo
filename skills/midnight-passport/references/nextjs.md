# Next.js and other server-rendering frameworks

`createPassport` reads `window` as soon as it is called, and `PassportProvider`
calls it while rendering. A server render therefore throws
`ReferenceError: window is not defined`, and `next build` fails prerendering the
page. Marking the file `'use client'` is **not** enough: client components are
still rendered on the server. Both patterns below were built with Next.js 14.2
(`next build`, static prerender) and walked in Chromium against
`https://midnight-passport-dev.vercel.app` on 2026/09/28.

The environment variable must be public to reach the browser:
`NEXT_PUBLIC_PASSPORT_ORIGIN=https://midnightpassport.com`. It holds an origin,
never a secret.

## Pattern A: the plain client, created after mount (no React bindings)

```tsx
// app/continue-with-passport.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { createPassport, type Passport, type PassportProfileResult } from '@midnight-passport/connect';

const PASSPORT_ORIGIN = process.env.NEXT_PUBLIC_PASSPORT_ORIGIN ?? 'https://midnightpassport.com';

export function ContinueWithPassport() {
  const passport = useRef<Passport | null>(null);
  const [result, setResult] = useState<PassportProfileResult | null>(null);
  const [pending, setPending] = useState(false);

  // createPassport reads `window`, so it is created after mount, never during the server render.
  useEffect(() => {
    const client = createPassport({ origin: PASSPORT_ORIGIN });
    passport.current = client;
    return () => client.destroy();
  }, []);

  async function onClick() {
    if (!passport.current) return;
    setPending(true);
    try {
      // First thing in the handler: the pop-up needs the click's user gesture.
      setResult(await passport.current.requestProfile(['displayName', 'passportContract']));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" disabled={pending} onClick={onClick}>Continue with Passport</button>
      {result && !result.approved && <p>{result.message}</p>}
      {result?.approved && <p>Signed in as {result.profile.displayName ?? 'a Passport holder'}.</p>}
    </div>
  );
}
```

Import it from a server component (`app/page.tsx`) as usual. Importing the
package on the server is safe; only calling `createPassport` there is not.

## Pattern B: the React bindings, loaded in the browser only

```tsx
// app/passport-panel.tsx
'use client';
import { PassportProvider, usePassportProfile } from '@midnight-passport/connect/react';

function Inner() {
  const profile = usePassportProfile(['displayName', 'passportContract']);
  return (
    <div>
      <button type="button" disabled={profile.pending} onClick={() => void profile.request()}>
        Continue with Passport
      </button>
      {profile.result && !profile.result.approved && <p>{profile.result.message}</p>}
    </div>
  );
}

export default function PassportPanel() {
  return (
    <PassportProvider origin={process.env.NEXT_PUBLIC_PASSPORT_ORIGIN ?? 'https://midnightpassport.com'}>
      <Inner />
    </PassportProvider>
  );
}
```

```tsx
// app/passport-panel-client.tsx
'use client';
import dynamic from 'next/dynamic';

// PassportProvider creates the client while rendering, and the client reads `window`.
export const PassportPanelClient = dynamic(() => import('./passport-panel'), { ssr: false });
```

`dynamic(…, { ssr: false })` must be called from a client component in the App
Router. Everything that uses the hooks must sit inside the dynamically loaded
subtree.

## Keeping the account on the server

After an approved profile, send `profile.passportContract` (and the name) to
your backend if you need it there, for example to call the partner API
(`partner-api.md`). Treat it as what the user chose to share, not as proof of
control: the pop-up and framed channels are not signed. If you need a reply
your server can verify, use the signed redirect channel
(`redirect-channel.md`) and verify on the callback page.

## Other frameworks

The same rule holds for Remix, Nuxt, SvelteKit, and Astro: create the client in
a browser-only lifecycle hook (`useEffect`, `onMounted`, `onMount`, a
`client:only` island), keep one per page, and call requests from click
handlers.
