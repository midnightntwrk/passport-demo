# Errors, refusals, and what to tell the user

Source: `packages/connect/src/protocol/errors.ts` at v5.0. Every result the
package returns carries `message`, one plain sentence for the person at the
screen. Show it. Do not keep your own map from codes to English; branch on the
code only to decide what to **do**.

## `source` is the whole design

- `source: 'passport'`: Passport answered. The user declined, or Passport would
  not act. This is a **decision**.
- `source: 'local'`: nothing reached Passport, or its answer never came back.
  This is a **problem with the page or the window**, not a decision.

## Profile codes (`PassportProfileErrorCode`, underscores)

| Code | Meaning | Package sentence |
| --- | --- | --- |
| `denied` | the user said no | You declined the request in Passport. Nothing was shared with this app. |
| `profile_unavailable` | no profile to share yet, or nothing ticked in the in-app sheet | Passport has no profile to share yet — it has not finished setting one up. |
| `invalid_request` | malformed request (your bug) | Passport rejected the request as malformed. That is this app’s bug, not yours. |
| `version_mismatch` | protocol revisions differ | This app and this Passport are speaking different revisions of the profile protocol. Nothing was shared. Updating either one will fix it. |

## Payment codes (`PassportTxErrorCode`, hyphens)

| Code | Meaning | Package sentence |
| --- | --- | --- |
| `declined` | the user declined on the sheet | You declined the payment on Passport’s approval sheet. Nothing was signed. |
| `insufficient-funds` | short of NIGHT, or of DUST for an unsponsored fee | The Passport account cannot cover this payment — it is short of NIGHT, or of the DUST that pays the network fee. |
| `wallet-unavailable` | no payable account open (includes every v5.0 Passport, see `transactions.md`) | No Passport session is open, so nothing could be signed. |
| `invalid-request` | a sheet was already open, or the recipient is not a valid unshielded address | Passport refused the request — it was already showing an approval sheet, or the recipient is not a valid unshielded address. |
| `network-mismatch` | recipient on another network | The recipient address belongs to a different network from the Passport account. |
| `submit-failed` | signed, but the node rejected it or was unreachable | It was signed, but the node rejected it or could not be reached. |
| `version-mismatch` | protocol revisions differ | …Nothing was signed and nothing was paid. Updating either one will fix it. |

A passport-side payment failure may add `detail` (a sentence from Passport);
`message` already joins the two.

## Local codes (`PassportLocalErrorCode`, never on the wire)

| Code | Meaning | Package sentence |
| --- | --- | --- |
| `popup-blocked` | `window.open` returned null | The browser blocked the Passport window, so nothing could be approved. Allow pop-ups for this site and try again. |
| `timed-out` | the budget (`timeoutMs`, 180 s) elapsed; **outcome unknown** | Passport did not answer in time. Check Passport before retrying, in case it got further than this page knows. |
| `passport-closed` | the window closed before answering | The Passport window was closed before it answered. Nothing was shared and nothing was paid. |
| `not-present` | framed, and nothing answered the handshake | No Passport answered. This page is framed by something that does not speak the Passport protocol. |
| `unsupported-transport` | `reportIncentive` in pop-up mode, or a destroyed client | This exchange only exists inside Passport’s own app browser. Nothing was sent. |
| `invalid-request` | refused before sending (bad field list, amount, purpose) | the same sentence as the payment code |

A cancelled **passkey prompt** is not a separate code: Passport handles it on
its own screen, and the app sees whatever Passport answers next (usually the
user declining or closing the window).

## Rules for your own copy

1. A timeout is not a decline. After a payment `timed-out`, say the payment may
   have gone through and ask the user to check Passport before trying again.
2. Do not retry by re-sending. One call is one exchange; a retry is a new call
   and the user is asked again. Never retry a `declined` or `denied` by itself.
3. Partial consent is success. Render what arrived; label the rest "not
   shared"; do not ask again in a loop.
4. Say what happened to the data or the money. Never "an error occurred",
   never "oops", never an apology.
5. "Network fee covered" only for `sponsored === true` on `submitted`.
