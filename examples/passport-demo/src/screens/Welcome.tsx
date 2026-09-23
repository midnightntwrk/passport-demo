import { ArrowRight } from 'lucide-react'

import ThemeToggle from './ThemeToggle.js'
import './identity.css'
import './welcome.css'

export interface WelcomeProps {
  onChooseName: () => void
}

/** The four benefits, shared with the custody road's welcome step. */
export const WELCOME_BENEFITS = [
  {
    image: '/welcome-art/identity.webp',
    title: 'An identity you hold',
    body: 'Your Passport is yours, secured by your passkey.',
  },
  {
    image: '/welcome-art/name.webp',
    title: 'A name people know',
    body: 'Choose a .night name instead of sharing a long address.',
  },
  {
    image: '/welcome-art/fees.webp',
    title: 'Start without tokens',
    body: 'Your Passport setup is paid for on your behalf.',
  },
  {
    image: '/welcome-art/privacy.webp',
    title: 'Share on your terms',
    body: 'Approve what an app learns. Keep the rest private.',
  },
] as const

export default function WelcomeScreen({ onChooseName }: WelcomeProps) {
  return (
    <section className="mnid-screen mnwl-screen">
      <header className="mnid-bar mnwl-bar">
        <img className="mnid-wordmark" src="/midnight-wordmark.svg" alt="Midnight" />
        <span className="mnid-step">Welcome</span>
        <ThemeToggle size="sm" className="mnid-theme" />
      </header>

      <div className="mnid-body mnwl-body">
        <div className="mnwl-intro">
          <p className="mnid-kicker">Your passkey is ready</p>
          <h1 className="mnid-title mnwl-title">Welcome to Passport.</h1>
          <p className="mnid-lede mnwl-lede">
            Your passkey holds your Passport. Give it a name, and it is ready to use.
          </p>
        </div>

        <ul className="mnwl-grid" aria-label="What your Passport gives you">
          {WELCOME_BENEFITS.map((benefit, index) => (
            <li key={benefit.title} className="mnwl-card">
              <div className="mnwl-art" aria-hidden="true">
                <img src={benefit.image} alt="" loading={index < 2 ? 'eager' : 'lazy'} />
              </div>
              <div className="mnwl-card-copy">
                <h2>{benefit.title}</h2>
                <p>{benefit.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mnwl-actions" data-toast-clear>
          <button type="button" className="mnwl-primary" onClick={onChooseName}>
            <span>Choose my .night name</span>
            <ArrowRight size={19} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  )
}
