import './passport-card.css'

/**
 * The photo page's card — the designed object this whole app is named after.
 *
 * A Passport user's identity leads: the `.night` name is the headline, the
 * portrait sits beside it, the issue data reads like a document, and the
 * account contract's address is expressed ONCE, at the foot, in
 * machine-readable-zone dress — a passport number, not a wallet address. The
 * card is the hero of the Passport tab (Home.tsx) and everything else on that
 * page hangs off it.
 *
 * THE GUARD CHIP IS THE MANDATORY-RECOVERY GATE, WORN ON THE CARD. A passport
 * that nobody could recover is a passport one house fire away from gone, so
 * until a second way in exists (today: an encrypted backup file; the recovery
 * keys of P3 later) the card says NOT VALID UNTIL GUARDED the way an unsigned
 * passport says it — on the document itself, not in a settings page. The chip
 * is a real button when the host supplies `onGuard`, and it opens the surface
 * where guarding happens.
 *
 * The portrait is the skunk mark on a tinted plate, and the TINT IS
 * DETERMINISTIC from the name: the same Passport always wears the same
 * colours, on every device, with nothing stored — the identity IS the seed.
 * (A generated per-name portrait is still an open design question; the tint
 * is the honest first step that already behaves like one.)
 */

export interface PassportCardProps {
  /** The full name held on this network — `alice.night` — or null. */
  domain: string | null
  /** Whether that name actually resolves for a sender yet. */
  nameRegistered: boolean
  /** What to call the holder when no name is held yet. */
  fallbackName: string | null
  /** The account contract's address — the passport number in the MRZ foot. */
  accountAddress: string | null
  /** When the account was issued (ISO). Rendered YYYY/MM/DD. */
  issuedAt: string | null
  /** The network this card is valid on. */
  network: string
  /** The mandatory-recovery gate, worn on the card. */
  guard: {
    guarded: boolean
    onGuard?: (() => void) | undefined
  }
}

/** djb2 over the name — six stable tints, one per Passport, forever. */
function portraitTint(seed: string): number {
  let hash = 5381
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(index)) >>> 0
  }
  return hash % 6
}

/** `2026-09-05T…` → `2026/09/05`; anything unreadable → null, never invented. */
function issuedDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}/${month}/${day}`
}

/** One MRZ line: uppercase, everything outside A–Z0–9 becomes `<`, 44 wide. */
function mrzLine(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '<')
    .padEnd(44, '<')
    .slice(0, 44)
}

/**
 * The passport number: the account address in MRZ dress. First 32 hex
 * characters in four groups, then the final four as the check-digit block —
 * enough to recognise the account, formatted as a document field rather than
 * a string to copy. (Copying happens in Show, where the full address lives.)
 */
function mrzNumber(address: string): string {
  const hex = address.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  const groups = [0, 8, 16, 24].map((start) => hex.slice(start, start + 8).padEnd(8, '<'))
  return mrzLine(`${groups.join('<')}<<${hex.slice(-4)}`)
}

export default function PassportCard(props: PassportCardProps) {
  const { domain, nameRegistered, fallbackName, accountAddress, issuedAt, network, guard } = props

  const label = domain ? domain.replace(/\.night$/, '') : null
  const holder = label ?? fallbackName ?? 'Unnamed'
  const tint = portraitTint(holder)
  const issued = issuedDate(issuedAt)

  const guardChip = guard.guarded ? (
    <span className="mnpcard-chip mnpcard-chip-ok">✦ GUARDED — PASSKEY + BACKUP</span>
  ) : guard.onGuard ? (
    <button type="button" className="mnpcard-chip mnpcard-chip-warn" onClick={guard.onGuard}>
      NOT VALID UNTIL GUARDED — TAP TO GUARD
    </button>
  ) : (
    <span className="mnpcard-chip mnpcard-chip-warn">NOT VALID UNTIL GUARDED</span>
  )

  return (
    <article className="mnpcard" aria-label="Your Passport">
      <img className="mnpcard-wm" src="/skunk/mark.svg" alt="" aria-hidden="true" />
      <p className="mnpcard-head">
        <span>Midnight Network</span>
        <span>Passport</span>
      </p>

      <div className="mnpcard-row">
        <span className={`mnpcard-portrait mnpcard-tint-${tint}`} aria-hidden="true">
          <img src="/skunk/mark.svg" alt="" />
        </span>
        <div className="mnpcard-id">
          <p className="mnpcard-kick">Name</p>
          {label ? (
            <h1 className="mnpcard-name">
              {label}
              <small>.night</small>
            </h1>
          ) : (
            <h1 className="mnpcard-name mnpcard-name-fallback">{holder}</h1>
          )}
          <dl className="mnpcard-fields">
            <div>
              <dt>Issued</dt>
              <dd>{issued ?? '—'}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{network}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* A held-but-unregistered name is not hidden — that would be its own
          confusion — but the card must not claim it resolves. */}
      {label && !nameRegistered ? (
        <p className="mnpcard-pending">This name is not registered on this network yet.</p>
      ) : null}

      {guardChip}

      {accountAddress ? (
        <p className="mnpcard-mrz" aria-label="Passport number">
          {mrzLine(`P<MIDNIGHT<<${(label ?? holder).replace(/\./g, '<')}<NIGHT`)}
          <br />
          {mrzNumber(accountAddress)}
        </p>
      ) : null}
    </article>
  )
}
