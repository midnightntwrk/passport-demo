/**
 * WHICH SHIELDED SENDS TO A RAW ADDRESS TODAY'S PASSPORTS MAY MAKE (2026/09/18).
 *
 * THE DEFECT, in the deployed account's own terms. Every Passport that exists
 * today lives on the prototype account build, and its `withdraw_shielded` has
 * two branches. Asked for the WHOLE coin of a colour it takes the `coins.remove`
 * branch: the entry goes, nothing is re-registered, and nothing is left behind
 * to be spent later. Asked for PART of one it splits — it pays the recipient and
 * then re-registers the remainder — and the coin it puts back is one the node
 * refuses every later withdrawal against (`1010 Invalid Transaction: Custom
 * error: 239`, hit live on stagenet). One partial withdrawal therefore costs the
 * account every shielded withdrawal after it, for as long as the account exists
 * — including the ones a `.night` name send makes.
 *
 * SO THE RULE IS THE AMOUNT, NOT THE ROUTE. The whole-coin branch is the one the
 * name path has used for weeks (`planShieldedSend` in `lib/sendLegs.ts` takes
 * the whole coin out and pays out of it), and it is safe. A partial amount to a
 * raw address is the one shape nothing else in this app asks for, and it is the
 * one that poisons the account. This module refuses exactly that, and leaves
 * every other send alone: NIGHT to an address, a whole shielded coin to an
 * address, and every name or account send, whatever the amount.
 *
 * AND IT REFUSES BEFORE ANYTHING IS SPENT OR SIGNED. The sheet asks it while the
 * amount is being typed, so the control is disabled with the sentence under the
 * field rather than after a passkey ceremony; `App.tsx` asks it again before it
 * builds anything, so no path around the sheet can reach the split branch.
 *
 * It is an INTERIM rule. The account contract that fixes this properly — where a
 * partial withdrawal leaves a spendable coin behind — is next, and a Passport on
 * it is not a prototype sender: {@link isPrototypeAccountBuild} stops being true
 * of it, and every send here goes back to what it was with nothing else changed.
 */

/** Which ledger the chosen asset is on, as the Send sheet's two modes name it. */
export type AddressSendAsset = 'night' | 'shielded';

/**
 * What is in the recipient field, in the same three kinds `lib/sendAssets.ts`
 * names — an address the codec has placed on a ledger, a `.night` name, or a
 * Passport account pasted directly.
 */
export type AddressSendRecipient = 'address' | 'name' | 'account';

/**
 * The build of the account contract the SENDER's Passport opens with, named as
 * `identity/contractRuntime.ts` names its modules.
 *
 * `'unknown'` is what a caller passes when it has not asked the chain which of
 * the two it is, and it is deliberately NOT a reason to allow anything: both
 * builds this client can open are compilations of the same deployed prototype,
 * so a Passport whose build has not been read is certainly on one of them.
 *
 * The union stays open (`string & {}`) because the build that fixes this does
 * not exist yet and this module must not pretend to know its name. What it does
 * know is which builds are the broken one, and that is what it lists.
 */
export type SenderAccountBuild = 'account' | 'account-v1' | 'unknown' | (string & {});

/**
 * The account builds whose `withdraw_shielded` burns the change it re-registers.
 *
 * Two names, one contract: `account-v1` is the eleven-circuit compilation of the
 * same `account_custody.compact` the twelve-circuit `account` module opens, and
 * the split branch is identical in both. A build not on this list is not one
 * this rule has anything to say about.
 */
export const PROTOTYPE_ACCOUNT_BUILDS: readonly string[] = ['account', 'account-v1'];

/**
 * Whether the sender is on the build that cannot survive a partial withdrawal.
 *
 * An unread build counts as one. The alternative — allowing the split branch
 * because nobody asked which build this is — would be the one failure mode this
 * whole module exists to prevent, and it would be reached by a network hiccup
 * rather than by a decision.
 */
export function isPrototypeAccountBuild(build: SenderAccountBuild | null | undefined): boolean {
  if (build === null || build === undefined || build === 'unknown') return true;
  return PROTOTYPE_ACCOUNT_BUILDS.includes(build);
}

/**
 * The sentence a partial amount earns, in the asset's own name.
 *
 * It says what WILL happen rather than what went wrong — the send is not broken,
 * it is whole-or-nothing for now — and it names both ways out: the control that
 * fills in the whole amount, and the route that still divides. Nothing in it
 * names a circuit, an error number, or any other machinery, because none of that
 * is the reader's to act on.
 *
 * `symbol` is absent where the caller has no ticker to hand — the backstop in
 * `App.tsx` is given a colour, not a name — and "balance" is then the plainest
 * true word for the thing being sent.
 */
export function partialAddressSendRefusal(symbol?: string | null): string {
  const what = symbol ? `your ${symbol}` : 'your balance';
  return `For now, sending to an address sends all of ${what} — Max fills in the whole amount. To send part of it, send to a .night name.`;
}

/** Everything the rule needs, and nothing it does not. */
export interface AddressSendPolicyInput {
  /** Which ledger the chosen asset is on. */
  asset: AddressSendAsset;
  /** What is in the recipient field. */
  recipient: AddressSendRecipient;
  /** Which build the sender's account opens with. */
  senderBuild: SenderAccountBuild | null;
  /** The amount asked for, in the asset's own atomic units, or `null` while there is none. */
  amount: bigint | null;
  /** What the account really holds of that colour, or `null` while it is unread. */
  held: bigint | null;
  /** The chosen asset's ticker, for the sentence. */
  symbol?: string | null;
}

/**
 * `null` when the send may proceed, or the sentence to show INSTEAD of sending.
 *
 * Every early return is a send this rule has nothing to say about, and each is
 * returned separately so the reason is readable rather than inferred from one
 * long condition:
 *
 *   - NIGHT is unshielded. `withdraw_night` has no split branch and no coin to
 *     re-register, so a partial NIGHT payment is exactly as safe as a whole one.
 *   - A name and a pasted account are the same route, and it takes the whole
 *     coin out already — the split branch is never reached by either.
 *   - A build that is not the prototype does not have the defect.
 *   - An amount that is not there yet — nothing typed, or a nought — is not a
 *     partial send of anything, and neither is a holding that has not been read.
 *     The sheet's own arithmetic owns "nothing typed" and "more than you hold",
 *     and saying something here would be a second sentence over the one the
 *     reader is already being shown.
 *
 * What is left is a partial shielded amount to a raw address from a prototype
 * sender, which is the one send that breaks the account.
 */
export function addressSendRefusal(input: AddressSendPolicyInput): string | null {
  if (input.asset !== 'shielded') return null;
  if (input.recipient !== 'address') return null;
  if (!isPrototypeAccountBuild(input.senderBuild)) return null;
  if (input.amount === null || input.amount <= 0n) return null;
  if (input.held === null) return null;
  /* THE WHOLE COIN IS THE SAFE BRANCH, and "more than is held" is somebody
     else's refusal — both are `>=` rather than `===` for that reason. */
  if (input.amount >= input.held) return null;
  return partialAddressSendRefusal(input.symbol);
}
