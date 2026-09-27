/**
 * ONE APPROVAL, FOR ONE ACTION, AND NOTHING THAT CAN SIGN LEFT BEHIND
 * (2026/09/27).
 *
 * THE QUESTION THIS ANSWERS
 * -------------------------
 * "I can send transfers without being prompted to confirm the transaction with
 * my passkeys, how is that possible?" (review, 2026/09/27.)
 *
 * It was possible because the key that approves a passkey Passport's calls — a
 * JubJub scalar derived from the 32 bytes one user-verified assertion yields
 * (`passportContractRoot` in `App.tsx`) — was derived ONCE and then held. The
 * passkey arm kept the device it built for the life of the page
 * (`usePasskeyCustodyArm`), and the custody screen kept it again for the life
 * of the screen (`ensureIdentity`, "the key that approves, settled once"). So
 * after the first ceremony — Create, or the first unlock after a reload — every
 * payment was signed by the key in memory, and nothing asked anybody. Anyone
 * holding the unlocked phone could move money with no tap, and so could any
 * script running in the page.
 *
 * THE RULE NOW
 * ------------
 * Every custody transaction that moves value or changes who controls the
 * account is signed by a device built from a FRESH assertion, asked for that
 * action and no other, and forgotten when the action is over:
 *
 *   {@link startPasskeyApproval} asks for the assertion FIRST — synchronously,
 *   before anything is awaited, so the press that started the action is still
 *   the gesture the browser sees — then builds the device, zeroes the root, and
 *   hands the device over. `release` forgets it (`forget` on the device, which
 *   leaves it unable to sign), and an answer that arrives after `release` is
 *   zeroed and forgotten on arrival.
 *
 *   {@link runApprovedWork} runs one payment under one approval and releases it
 *   when the payment is over — after its tidy-up where it has one, the note of
 *   the change it kept, which is part of the same payment and signed by the
 *   same approval. A payment that was not approved never reaches its work: the
 *   engine is not called, so nothing is built, proved, or submitted.
 *
 * What is kept between actions is only what is PUBLIC: the key a Passport's
 * stores are filed under (its device point) and the pointer that names it. The
 * scalar, the viewing secret, and the maintenance key are rebuilt from a new
 * assertion each time and never outlive the action they were asked for.
 *
 * A PROVIDER SIGN-IN IS NOT ASKED HERE. Its key is the provider's and it signs
 * inside the provider, call by call; there is nothing on this side to build or
 * to forget. {@link providerApproval} is that arm's approval: it hands back the
 * identity the arm already knows, asks for nothing, and holds nothing.
 *
 * NO REACT, NO STORAGE, NO PASSKEY. The ceremony and the device are injected,
 * so every branch is drilled in `./custodyApproval.test.ts`.
 */

/** One approval, for one action. */
export interface CustodyApproval<Identity> {
  /**
   * Settles when the prompt has been answered — either way — which is the
   * moment "Waiting for your approval" stops being true. Never rejects.
   */
  readonly answered: Promise<void>
  /**
   * The device that approves this one action, once it is built. Rejects when
   * the approval was not given — dismissed, refused, timed out, or released
   * before it arrived — and nothing can be signed then.
   */
  readonly ready: Promise<Identity>
  /**
   * Ends the approval. What was built is forgotten now; an answer still to come
   * is zeroed and forgotten when it arrives. Safe to call more than once.
   */
  release(): void
}

/** What a device built from a contract root hands back. */
export interface ApprovedDevice<Identity> {
  readonly identity: Identity
  /** Leaves the device unable to sign, and zeroes what can be zeroed. */
  forget(): void
}

/** What {@link startPasskeyApproval} needs, injected. */
export interface PasskeyApprovalSeams<Identity> {
  /**
   * ONE user-verified assertion, reduced to the 32-byte contract root. Called
   * FIRST and synchronously, so the press that started the action is still
   * the gesture the browser sees when the prompt is raised.
   */
  readonly contractRoot: () => Promise<Uint8Array>
  /** The device, built from the root. The root is zeroed when this settles. */
  readonly build: (root: Uint8Array) => Promise<ApprovedDevice<Identity>>
}

/** What an approval that was let go before it arrived rejects with. */
export const CUSTODY_APPROVAL_ENDED = 'That approval has ended. Nothing was signed with it.'

/**
 * The sentence a payment whose approval was not given ends in: dismissed,
 * refused, or unusable on this device. Nothing was signed, so nothing moved.
 */
export const CUSTODY_PAYMENT_NOT_APPROVED = 'This payment was not approved. Nothing left your Passport.'

/**
 * Asks for one approval from a passkey.
 *
 * THE ORDER IS THE POINT. `contractRoot` is called before anything else in this
 * function and before anything is awaited — the prompt is up by the time this
 * returns — because a browser that requires a gesture for a passkey prompt
 * judges it at the moment `navigator.credentials.get` is called, and an await
 * in front of that call is the gesture spent. Everything else (loading the
 * contract module, deriving the device) happens after the prompt is asked for.
 *
 * THE ROOT IS ZEROED ON EVERY ROAD OUT: built, failed to build, or arrived
 * after the approval was let go.
 */
export function startPasskeyApproval<Identity>(
  seams: PasskeyApprovalSeams<Identity>,
): CustodyApproval<Identity> {
  /* Called in THIS turn — an async function runs up to its first await at
     once — and a ceremony that throws before it starts becomes a refusal like
     any other rather than a throw out of the press. */
  const asked = (async () => seams.contractRoot())()
  let released = false
  let made: ApprovedDevice<Identity> | null = null
  const ready = asked.then(async (root) => {
    try {
      if (released) throw new Error(CUSTODY_APPROVAL_ENDED)
      const built = await seams.build(root)
      if (released) {
        built.forget()
        throw new Error(CUSTODY_APPROVAL_ENDED)
      }
      made = built
      return built.identity
    } finally {
      root.fill(0)
    }
  })
  /* Nobody may be waiting on it — an approval let go before its answer — and
     an unawaited rejection is a console error about something that went
     exactly as intended. Anybody who does await it still sees the rejection. */
  ready.catch(() => undefined)
  return {
    answered: asked.then(
      () => undefined,
      () => undefined,
    ),
    ready,
    release() {
      released = true
      made?.forget()
      made = null
    },
  }
}

/**
 * The approval of an arm whose key is somebody else's to use — a provider
 * sign-in, which signs inside the provider on every call.
 *
 * Nothing is asked here and nothing is held here, so there is nothing to
 * release. The identity is asked for the first time `ready` is read and not
 * before, so a payment on that arm still reaches its signing point in the order
 * it always did.
 */
export function providerApproval<Identity>(identity: () => Promise<Identity>): CustodyApproval<Identity> {
  let asked: Promise<Identity> | null = null
  return {
    answered: Promise.resolve(),
    get ready(): Promise<Identity> {
      asked ??= (async () => identity())()
      return asked
    },
    release: () => undefined,
  }
}

/** How one payment is run under its approval. */
export interface ApprovedWorkOptions {
  /**
   * Whether the approval is answered before the payment does anything else —
   * true for a passkey, whose Confirm press IS the approval, so the progress
   * reads "Waiting for your approval" first and a payment that was not
   * approved never starts. False for a provider sign-in, which approves inside
   * the call, at the signing point, as it always has.
   */
  readonly approvalFirst: boolean
  /** Told once the prompt has been answered, either way. */
  readonly onAnswered?: () => void
  /**
   * The sentence a payment that was not approved ends in, or null to let the
   * arm's own refusal through unchanged — the provider arm's, whose sentences
   * are already written for the screen.
   */
  readonly notApproved: string | null
}

/**
 * Runs one payment under ONE approval, and ends the approval when the payment
 * is over.
 *
 * `work` is handed `approved`, which resolves with the device at the moment the
 * payment signs. The approval is released on every road out: when the work
 * throws, when it finishes with nothing to follow, or — where it hands back a
 * tidy-up, the note of the change the payment kept — once that tidy-up has run,
 * because it is part of the same payment and is signed by the same approval.
 * Nothing signed by this approval can happen after that.
 *
 * A payment that was not approved never calls `work`, when `approvalFirst`:
 * the engine is never reached, so nothing is built, proved, or submitted.
 */
export async function runApprovedWork<Identity>(
  approval: CustodyApproval<Identity>,
  options: ApprovedWorkOptions,
  work: (approved: () => Promise<Identity>) => Promise<(() => Promise<void>) | void>,
): Promise<(() => Promise<void>) | void> {
  const approved = async (): Promise<Identity> => {
    try {
      return await approval.ready
    } catch (cause) {
      if (options.notApproved === null) throw cause
      throw new Error(options.notApproved, { cause })
    }
  }
  let handedOn = false
  try {
    if (options.approvalFirst) {
      await approval.answered
      options.onAnswered?.()
      await approved()
    }
    const tidyUp = await work(approved)
    if (typeof tidyUp !== 'function') return undefined
    handedOn = true
    return async () => {
      try {
        await tidyUp()
      } finally {
        approval.release()
      }
    }
  } finally {
    if (!handedOn) approval.release()
  }
}
