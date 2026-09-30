# Background push for payments received

2026/09/30. Status: built, off until configured, not deployed anywhere.

When one Passport pays another Passport's account, the recipient's devices can
show "You received a payment — Open Passport to see it." even with Passport
closed. It rides on Firebase Cloud Messaging (FCM) and is OFF in any build that
lacks the Firebase values below, which is every build shipped before this change.

## How it works

1. **Opt in.** On Home, turning notifications on (the existing toggle) also
   subscribes the browser to Web Push and exchanges that subscription for an FCM
   registration token, then posts `{ account, token }` to `/api/push/register`.
   Turning them off posts to `/api/push/unregister` and unsubscribes.
2. **Pay.** After a custody Passport's payment to another Passport account goes
   out, the sender's Passport posts `{ recipientAccount, txHash }` to
   `/api/push/notify`. Fire and forget: it never holds up or fails the send.
3. **Verify and send.** The server looks the transaction up on the stagenet
   indexer, requires a contract action on `recipientAccount` and a block less
   than 15 minutes old (retrying for about 20 s while the indexer catches up),
   records the hash once (a repeat is a no-op), and sends a data-only message to
   each of the account's tokens. Tokens FCM reports dead are removed.
4. **Show.** `public/sw.js` draws the notification from its `push` handler; a tap
   opens or focuses Passport.

The FCM token is obtained **without the Firebase SDK**: `src/lib/push.ts`
replicates the two REST calls `firebase/messaging` makes (a Firebase
Installation, then an `fcmregistrations` registration carrying the Web Push
endpoint, keys, and our VAPID public key), taken from the published source of
`@firebase/installations` 0.6.24 and `@firebase/messaging` 0.13.3. The server
uses the FCM HTTP v1 API and Firestore's REST API with an OAuth2 token minted
from the service account using `node:crypto`. No npm dependency was added.

## Configuration

| Variable | Where | Secret? | Notes |
|---|---|---|---|
| `VITE_FIREBASE_API_KEY` | build env | No | Turns push on, with the app id. |
| `VITE_FIREBASE_APP_ID` | build env | No | |
| `VITE_FIREBASE_PROJECT_ID` | build env | No | Default `midnight-passport-demo`. |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | build env | No | Default `555154905726`. |
| `VITE_FIREBASE_VAPID_KEY` | build env | No | Default the project's Web Push public key. |
| `FIREBASE_SERVICE_ACCOUNT` | Vercel project env (runtime) | **Yes** | The whole service-account JSON. Never in the repository, never in a `VITE_` variable. Missing: every endpoint answers `503 { "error": "push-unavailable" }`. |
| `PUSH_INDEXER_URL` | Vercel project env | No | Optional; default the stagenet indexer. |

The service account needs the Firebase Cloud Messaging API and Cloud Firestore
(native mode, `(default)` database). Optionally add a Firestore TTL policy on
`passportPushSent.expireAt` to clear the dedupe records after a week.

The prebuilt deploy (`scripts/build-vercel-output.mjs`) bundles
`examples/passport-demo/api/push/*.ts` into Node functions under
`.vercel/output/functions/api/push/`. The SPA rewrite in `vercel.json` excludes
`/api/`.

## Privacy

- The message carries no amount, name, or address — only the fixed sentence and
  the transaction hash, which is public on chain.
- The server stores an account address and up to five push tokens for it, and
  the hash of each transaction it has announced. Nothing else.
- Every notify is checked on the indexer before anyone is told, and the answer
  is the same whether the account has devices or not.
- A caller can still trigger one notification for a real, recent transaction
  that touched an account; the per-transaction dedupe bounds that to one.

## Limits

- **iPhone:** only a Passport added to the Home Screen, on iOS 16.4 or later,
  can receive a push. A Safari tab cannot, and the toggle there is unchanged.
- **Not covered:** the opening balance and gifts, which come from the Passport
  service rather than from another Passport; payments to a plain shielded
  address; payments from the older prototype Passport.
- One subscription per browser: a browser registered for one Passport stops
  being registered for it when it turns push on for another.

## Manual test, once the environment is set

1. Set the five `VITE_FIREBASE_*` values for a build (staging or the dev
   project) and `FIREBASE_SERVICE_ACCOUNT` in that Vercel project's env.
2. Build and package: `npm run build` in `examples/passport-demo`, then
   `node scripts/build-vercel-output.mjs examples/passport-demo`; deploy through
   the normal release path.
3. `curl -X POST https://<host>/api/push/register -H 'content-type: application/json' -d '{}'`
   should answer `400 invalid-account` (not `503`, which means the service
   account is missing).
4. Device A (Android Chrome, or an iPhone Home Screen app): open Passport, turn
   notifications on. In Firestore, `passportPush/<A's account>` should hold one
   token.
5. Close Passport on device A entirely.
6. Device B: pay A's `.night` name. Within about a minute A should show
   "You received a payment". Tapping it opens Passport.
7. `passportPushSent/<txHash>` exists; re-posting the same notify sends nothing.
8. On A, turn notifications off; the token disappears from Firestore and a
   further payment shows nothing.
