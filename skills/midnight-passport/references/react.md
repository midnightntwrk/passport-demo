# React: `@midnight-passport/connect/react`

Source: `packages/connect/src/react/index.tsx` (v5.0). Peer dependency
`react` >= 18. The module has no `'use client'` directive, and
`PassportProvider` creates the client while rendering, so it **throws on a
server render** (`ReferenceError: window is not defined`). In Next.js or any
SSR framework read `nextjs.md` first.

## `<PassportProvider origin="…">`

Put it once, near the root. It accepts every `CreatePassportOptions` field as a
prop (`origin`, `transport`, `timeoutMs`, `presenceTimeoutMs`, `closedPollMs`,
`popupFeatures`) and re-creates the client when any of them changes identity,
so pass stable values (no inline `transport` object). It destroys the client on
unmount.

```tsx
import { PassportProvider } from '@midnight-passport/connect/react';

<PassportProvider origin={import.meta.env.VITE_PASSPORT_ORIGIN}>
  <App />
</PassportProvider>
```

## `usePassport({ detect?, trafficLimit? })`

Returns `{ passport, mode, presence, traffic }`. `presence` is `null` until
detection settles (`detect: false` skips it); `traffic` is the message
transcript, newest last, capped at `trafficLimit` (default 24). Render
`traffic` in a dev panel when debugging.

## `usePassportProfile(fields)`

Returns `{ request(), result, pending, reset() }`. `fields` may be an inline
array literal; the hook keys on the values.

## `usePassportPayment()`

Returns `{ request(intent), reportIncentive(incentive), result, pending, reset() }`.

Hooks throw `usePassport must be used inside a <PassportProvider origin="…">.`
outside the provider.

## Pattern

```tsx
import { usePassportPayment, usePassportProfile } from '@midnight-passport/connect/react';

function Door({ shopAddress }: { shopAddress: string }) {
  const profile = usePassportProfile(['displayName', 'passportContract']);
  const payment = usePassportPayment();
  const who = profile.result;

  return (
    <>
      <button disabled={profile.pending} onClick={() => void profile.request()}>
        Continue with Passport
      </button>
      {who && !who.approved && <p>{who.message}</p>}
      {who?.approved && (
        <p>
          {who.profile.displayName ? `Signed in as ${nightName(who.profile.displayName)}.` : 'Signed in.'}
          {who.withheld.length > 0 && ` Not shared: ${who.withheld.join(', ')}.`}
        </p>
      )}

      <button
        disabled={payment.pending}
        onClick={() => void payment.request({ recipientAddress: shopAddress, amount: '100000', purpose: 'Cover charge' })}
      >
        Pay 0.1 NIGHT
      </button>
      {payment.result?.status === 'submitted' && (
        <p>Sent.{payment.result.sponsored ? ' Network fee covered.' : ''}</p>
      )}
      {payment.result && payment.result.status !== 'submitted' && <p>{payment.result.message}</p>}
    </>
  );
}

const nightName = (name: string) => (name.endsWith('.night') ? name : `${name}.night`);
```

- Call `request()` in the click handler, not in an effect: the pop-up needs the
  gesture.
- "Signed in" is `result.approved === true` and nothing else.
- `reset()` clears the last result; it does not cancel an exchange in flight.
- Read `transactions.md` before shipping the payment button: on v5.0 a Passport
  made on v5.0 answers it with `wallet-unavailable`.
