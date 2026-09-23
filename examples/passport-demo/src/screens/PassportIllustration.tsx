import './passport-illustration.css'

/** Decorative illustration of a credential sharing a proof, not its fields. */
export default function PassportIllustration() {
  return (
    <div className="mn-passport-art" aria-hidden="true">
      <svg viewBox="0 0 320 208" fill="none" focusable="false">
        <g className="mn-passport-art-float">
          <rect className="mn-passport-art-backing" x="67" y="32" width="184" height="126" rx="16" transform="rotate(5 159 95)" />
          <g transform="rotate(-6 147 101)">
            <rect x="55" y="38" width="184" height="126" rx="16" fill="#0000FE" />
            <rect x="55.5" y="38.5" width="183" height="125" rx="15.5" stroke="white" strokeOpacity=".16" />
            <image className="mn-passport-art-mark" href="/midnight-symbol.svg" x="72" y="54" width="26" height="26" />
            <text x="218" y="70" textAnchor="end" fill="white" fontSize="9" fontWeight="500" letterSpacing="1.8">PASSPORT</text>
            <path d="M73 94H221" stroke="white" strokeOpacity=".18" />
            <g fill="white" fillOpacity=".55">
              <circle cx="76" cy="111" r="3" />
              <circle cx="87" cy="111" r="3" />
              <circle cx="98" cy="111" r="3" />
              <circle cx="109" cy="111" r="3" />
              <circle cx="120" cy="111" r="3" />
              <circle cx="131" cy="111" r="3" />
            </g>
            <path d="M73 128H132M73 136H112" stroke="white" strokeOpacity=".25" strokeWidth="3" strokeLinecap="round" />
            <g stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".85">
              <rect x="204" y="126" width="13" height="11" rx="3" />
              <path d="M207 126V123a3.5 3.5 0 0 1 7 0v3M210.5 130v3" />
            </g>
          </g>
        </g>
        <g className="mn-passport-art-proof">
          <rect className="mn-passport-art-proof-bg" x="196" y="129" width="104" height="38" rx="19" />
          <circle className="mn-passport-art-check-bg" cx="217" cy="148" r="10" />
          <path className="mn-passport-art-check" d="m213 148 2.5 2.5 5-5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <text className="mn-passport-art-proof-text" x="233" y="152" fontSize="12" fontWeight="500">Verified</text>
        </g>
      </svg>
    </div>
  )
}
