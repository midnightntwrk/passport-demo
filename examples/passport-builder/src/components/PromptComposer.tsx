import { ArrowUpRight, LoaderCircle } from 'lucide-react';

interface Props {
  prompt: string;
  setPrompt: (value: string) => void;
  busy: boolean;
  disabled?: boolean;
  compact?: boolean;
  onSubmit: () => void;
}

export function PromptComposer({ prompt, setPrompt, busy, disabled, compact, onSubmit }: Props) {
  return <form className={`composer ${compact ? 'compact' : ''}`} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <label className="sr-only" htmlFor={compact ? 'revision-prompt' : 'idea-prompt'}>{compact ? 'Describe a change' : 'Describe your app idea'}</label>
    <textarea id={compact ? 'revision-prompt' : 'idea-prompt'} value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={busy} maxLength={12000}
      placeholder={compact ? 'What would you like to change?' : 'A community poll. An on-chain registry. Your next idea…'}
      onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && prompt.trim() && !busy && !disabled) { event.preventDefault(); onSubmit(); } }} />
    <div className="composer-footer">
      <button className="button primary" type="submit" disabled={busy || disabled || !prompt.trim()}>
        {busy ? <LoaderCircle className="spin" size={17} /> : null}
        {busy ? 'Working…' : compact ? 'Send' : 'Build app'}
        {!busy && <ArrowUpRight size={18} />}
      </button>
    </div>
  </form>;
}
