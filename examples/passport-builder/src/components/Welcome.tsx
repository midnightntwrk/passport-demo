import { ArrowRight, ClipboardList, FileText, Fingerprint, Users } from 'lucide-react';
import type { ComponentProps } from 'react';
import midnightSymbol from '../assets/midnight-symbol.svg';
import { PromptComposer } from './PromptComposer';

const starters = [
  { name: 'Project board', description: 'Create tasks. Move work forward.', icon: ClipboardList, prompt: 'Build a public collaborative project board on Midnight stage-net using Passport. Store individual TaskRecord entries in a Map keyed by Uint<64>, with an Open, InProgress, or Done status enum. Use parameterised circuits to create, start, and complete tasks. Reject duplicate IDs and invalid status transitions in the contract. Render actual ledger Map records in the board, with forms for task data. Explain that the records are public and any participant may change them; do not claim owner-only access or identity uniqueness.' },
  { name: 'Member registry', description: 'Register members. Manage active status.', icon: Users, prompt: 'Build a public member registry on Midnight stage-net using Passport. Store each member ID and label in a Map keyed by Bytes<32>, and maintain a Set of active member IDs. Use parameterised circuits to register, deactivate, and reactivate members. Reject duplicate registrations, unknown IDs, and invalid active-status changes in the contract. Render actual ledger Map and Set data as searchable member records, not just a total. Explain that this is a public collaborative registry, with no enforced identity uniqueness or owner-only access.' },
  { name: 'Proposal workflow', description: 'Draft proposals. Open and close them.', icon: FileText, prompt: 'Build a public proposal workflow on Midnight stage-net using Passport. Store individual proposal records in a Map keyed by Uint<64>, including their label and Draft, Open, or Closed status enum. Use parameterised circuits to create, open, and close proposals. Reject duplicate IDs, unknown proposals, and invalid lifecycle transitions in the contract. Render actual ledger Map records and enable actions according to each proposal’s current state. Explain that anyone may participate in this public collaborative prototype; do not claim owner-only permissions or identity uniqueness.' },
];

/** Decorative Passport cover, using the product's original Midnight artwork. */
export function PassportArtwork() {
  return <div className="passport-art" aria-hidden="true">
    <div className="passport-page page-back" /><div className="passport-page page-front" />
    <div className="passport-cover"><img src={midnightSymbol} alt="" /><span className="passport-cover-label">Passport</span><Fingerprint size={45} strokeWidth={1.2} /><span className="passport-cover-caption">One connection.<br />Every app.</span></div>
  </div>;
}

export function Welcome(composer: ComponentProps<typeof PromptComposer>) {
  return <section className="welcome" aria-labelledby="welcome-title">
    <div className="welcome-content">
      <div className="welcome-hero"><div className="welcome-copy">
        <p className="eyebrow">Built with Midnight Passport</p>
        <h1 id="welcome-title">Your idea.<br />On Midnight.</h1>
        <p className="intro">Build an app with Passport built in. Describe it, shape it, then take it to stage-net.</p>
      </div><PassportArtwork /></div>
      <PromptComposer {...composer} />
      <div className="starter-prompts" aria-label="Idea starters">
        {starters.map(({ name, description, icon: Icon, prompt }) => <button key={name} onClick={() => { composer.setPrompt(prompt); document.getElementById('idea-prompt')?.focus(); }} disabled={composer.busy}><Icon size={22} strokeWidth={1.6} /><span><strong>{name}</strong><small>{description}</small></span><ArrowRight size={17} aria-hidden="true" /></button>)}
      </div>
    </div>
  </section>;
}
