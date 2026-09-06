import { Check, Copy, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { encodeReceivePayload } from '../lib/qrPayload.js'
import './show-passport.css'

/**
 * Show — presenting your Passport, full screen.
 *
 * The Apple Wallet gesture: a pass is a designed object you SHOW, and showing
 * it is a first-class act because receiving anything — money, a connection, a
 * credential request — starts with the other side learning who you are. This
 * replaced the Receive modal in the identity-first redesign (P2): the code
 * and its payload are identical (`lib/qrPayload.ts`, both directions in one
 * module), but the surface stopped being a wallet's "receive address" sheet
 * and became the document held up to be read.
 *
 * ALWAYS ON THE NIGHT PLATE, both themes: a camera reads contrast, not CSS,
 * so the code sits on its own white plate inside the ink surface exactly as
 * the QR specification's quiet zone expects (drawn INTO the matrix — see the
 * `border: 4` below).
 *
 * ONE ADDRESS, still. The name leads; the account address the name points at
 * is the technical detail at the foot, because until senders resolve names an
 * address is what a transfer needs. It is the only place the address is
 * expressed in full, as it was on the Receive sheet before it.
 */

export interface ShowPassportProps {
  /** The full name — `alice.night` — or null when none is held yet. */
  domain: string | null
  /** Whether the name actually resolves for a sender on this network. */
  nameRegistered: boolean
  /** The account the name points at — what the code carries behind the name. */
  accountAddress: string | null
  onClose: () => void
}

function truncateHash(hash: string): string {
  if (hash.length <= 18) return hash
  return `${hash.slice(0, 9)}...${hash.slice(-7)}`
}

export default function ShowPassport(props: ShowPassportProps) {
  const { domain, nameRegistered, accountAddress, onClose } = props

  const [copied, setCopied] = useState(false)
  const payload = encodeReceivePayload({ domain, accountAddress })
  const [code, setCode] = useState<{ size: number; path: string } | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setCode(null)
    if (!payload) return undefined
    let live = true
    /* Imported only when Show opens: a QR generator has no business in the
       first bundle of a Passport that is never shown. Content-hashed, so
       every opening after the first is served from the cache. */
    void import('uqr')
      .then(({ encode }) => {
        if (!live) return
        /* `border: 4` is the quiet zone the QR specification asks for, drawn
           INTO the matrix rather than left to a stylesheet — a camera reads
           the image, not the CSS around it. */
        const matrix = encode(payload, { ecc: 'M', border: 4 })
        let path = ''
        for (let row = 0; row < matrix.size; row += 1) {
          for (let column = 0; column < matrix.size; column += 1) {
            if (matrix.data[row]?.[column]) path += `M${column} ${row}h1v1h-1z`
          }
        }
        setCode({ size: matrix.size, path })
      })
      .catch((cause: unknown) => {
        // The name and address below still work; nothing here claims otherwise.
        console.warn('[passport] the Show code could not be drawn:', cause)
      })
    return () => {
      live = false
    }
  }, [payload])

  const handleCopyAccount = useCallback(() => {
    if (!accountAddress) return
    void navigator.clipboard?.writeText(accountAddress).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1_600)
      },
      () => undefined,
    )
  }, [accountAddress])

  return createPortal(
    <div className="mnshow" role="dialog" aria-modal="true" aria-label="Show your Passport">
      <div className="mnshow-bar">
        <p className="mnshow-kicker">Your Passport</p>
        <button type="button" className="mnshow-close" onClick={onClose} aria-label="Close">
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="mnshow-stage">
        {/* No name means no code: a square carrying only a raw account is one
            no Passport can scan, and drawing it would be a promise this
            surface cannot keep. */}
        {payload ? (
          <div className="mnshow-plate">
            {code ? (
              <svg
                className="mnshow-code"
                viewBox={`0 0 ${code.size} ${code.size}`}
                shapeRendering="crispEdges"
                role="img"
                aria-label={`QR code for ${domain ?? 'your Passport'}`}
              >
                <path d={code.path} fill="#000000" />
              </svg>
            ) : (
              <div className="mnshow-wait" aria-hidden="true" />
            )}
          </div>
        ) : null}

        {domain ? <p className="mnshow-name">{domain}</p> : null}
        <p className="mnshow-note">
          {domain
            ? nameRegistered
              ? 'Scan this from another Passport to send here, or show it to connect.'
              : 'This name is not registered on this network yet — use the address below until it is.'
            : 'No name is held on this network yet — the address below is what works meanwhile.'}
        </p>
      </div>

      {/* The one full address on any surface: the account the name points at.
          Never the wallet's — machinery is not somewhere to send value. */}
      <div className="mnshow-foot">
        <div className="mnshow-address">
          <span className="mnshow-address-label">Your account</span>
          <code className="mnshow-address-value">
            {accountAddress ? truncateHash(accountAddress) : 'Not available'}
          </code>
          <button
            type="button"
            className="mnshow-copy"
            onClick={handleCopyAccount}
            disabled={!accountAddress}
            aria-label="Copy your account address"
          >
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </button>
        </div>
        <p className="mnshow-foot-note">A public receiving address — never the keys behind it.</p>
      </div>
    </div>,
    document.body,
  )
}
