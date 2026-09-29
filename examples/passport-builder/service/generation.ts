import { modelTextStream } from './model-stream.js';
import type { Project } from '../shared/types.js';
import { parseGeneration, type GenerationContext } from './validation.js';
import { IncrementalGenerationParser, type PartialGenerationFiles } from './incremental-generation.js';
import { contractPatternInstructions } from './contract-patterns.js';
import { BOILERPLATE_INSTRUCTIONS } from './boilerplate.js';
import { passportSkillContext } from './passport-skill.js';

const INSTRUCTIONS = `Build the user's actual Midnight app with Compact 0.34.0 (language 0.26) and React 18. Return ONLY JSON: {"name":"short name","description":"behaviour and limitations","files":{}} with complete replacement strings for changed files. Add "base":"crud" only when explicitly selecting that new-app boilerplate.
Output only changed files. Allowed paths: contract.compact, src/App.tsx, src/styles.css. Existing apps inherit omitted files unchanged; never resend unchanged contract or CSS. A new custom app without a base must supply contract.compact and src/App.tsx; omitted CSS defaults to empty. File values are full replacements, not patches. No packages, servers, setup, keys, or deployment configuration.

Use maintained UI to avoid reimplementing forms, styling, and wallet setup. Allowed imports: react, lucide-react, @midnight-passport/app, @midnight-passport/ui, @midnight-passport/assets. No other files/libraries/URLs, dynamic imports, fetch, storage, wallet injection, or direct postMessage. App must export default function App(). CSS is host-applied: do not import it.
@midnight-passport/ui exports:
- CrudApp({title?,description?,itemName?,labelName?,valueName?}), all strings; supplies the entire documented CRUD UI, Passport flow, confirmation, and shared styling.
- AppShell({title:string,description?:string,actions?:ReactNode,footer?:ReactNode,children:ReactNode}), the styled wrapper for custom apps.
- Button: normal button props, variant?:'primary'|'secondary'|'danger'. Field: normal input props plus label:string,help?:string,error?:string. Status({children:ReactNode,tone?:'info'|'error'|'success'}).
AppShell defaults to a dark theme. Its CSS tokens are --ui-bg, --ui-surface, --ui-raised, --ui-ink, --ui-muted, --ui-line, --ui-blue, --ui-focus, --ui-red on .mpui. When using light sections, set background and foreground together and override these tokens within that section, including input text, placeholder and button colours. Never put dark headings on the dark shell or light input text on pale fields. Prefer these components and empty or small CSS overrides. Preserve requested branding and existing design. For custom layouts, make the actual task central, with readable responsive spacing, explicit labels, keyboard focus, and useful empty/loading/error states. No generic marketing filler, fake activity, inaccessible icon-only actions, untrusted external assets, or repeated CSS frameworks. Generated images may be rendered only through the maintained Asset component.

Compact rules:
- pragma language_version >= 0.26; import CompactStandardLibrary; empty constructor arguments. No witnesses/private state, other imports/modules, token/coin/value transfers, mint/burn, or user keys.
- Implement domain entities and real persistent actions: Map records, struct fields, Set membership, enums/bounded lifecycle state. A workflow needs enforced transitions, not a renamed counter. Never emit no-op feature circuits. A caller-supplied ID or Passport profile does not enforce on-chain identity/ownership; describe permissionless behaviour honestly.
- Disclose public inputs before ledger operations or assertions. Export arguments only Uint<N>, Boolean, Bytes<N>; send unsigned integers as decimal strings, booleans as booleans, bytes as exact-length hex. Use Uint ordering, not Field ordering. Map.member before lookup; update structs with complete values. Avoid collection-valued nested Maps because readLedger cannot enumerate them.
- Keep requested records/actions when repairing compiler errors. Never silently turn a requested functional product into a demonstration or mockup. Every main control must perform its real action and query the resulting state. If an essential requested capability requires private state, asset transfers, payments, minting, or on-chain identity/ownership enforcement that this runtime cannot execute, return ONLY {"unsupported":"Explain the concrete missing capability and why the requested product cannot currently run."}. Do not return placeholder code, demo-only substitutes, fake actions, or a renamed counter. Optional features may be omitted only when the user explicitly permits that scope.

Custom app runtime (CrudApp already handles this):
import { usePassport } from '@midnight-passport/app'; its hook exposes profile, connected, connecting, transacting, connect, callContract, waitForTransaction, readLedger, ledgerVersion, lastTransaction, contractAddress, network. Methods have stable identities. Network is stagenet. Missing contractAddress means preview: disable writes. Passport owns onboarding; profile has optional displayName/passportContract.
- connect():Promise<profile>. callContract(circuit,args,purpose):Promise<{txId,status:'unknown'|'submitted'|'confirmed'|'failed'}> opens user approval. args must be an ARRAY in the circuit's declared parameter order, never a named object: callContract('createOffer', [id, encodedLabel, encodedDetails], 'Create offer'). purpose must identify the action and affected record within 240 characters. Never write automatically or fabricate success. Keep inputs and prevent duplicate writes while awaiting approval/confirmation. The complete UI is typechecked against the maintained runtime before publication; do not suppress type errors.
- After submission, await waitForTransaction(txId):Promise<{txId,status:'unknown'|'submitted'|'confirmed'|'failed',blockHeight?,message?}>. It accepts this app's prepared IDs and polls for a bounded time; unknown means the approval/submission outcome is unknown; keep writes disabled and offer a status check. submitted still means pending, confirmed means indexed success, failed may include partial execution. Show txId/status, preserve inputs/errors, and refresh the ledger before offering retry. Never resend automatically or call a timeout a confirmed failure.
- lastTransaction is the latest unknown/submitted/confirmed/failed result; ledgerVersion increases on indexed execution. Use useEffect with [contractAddress,ledgerVersion,readLedger] to refresh deployed state and also offer manual refresh. No permanent initial-read guard.
- readLedger():Promise<Record<string,unknown>> returns integers as decimal strings, bytes as hex, enum variants as numeric indices from zero, structs as named objects; Map:{entries:[[key,value],...],size:string,truncated:boolean}, Set:{values:[...],size:string,truncated:boolean}. Max200 collection entries, order unspecified. Render records from entries/values, sort explicitly if needed, respect truncation, and distinguish unknown/error from empty. Data is public; never invent totals/users/balances.
Only confirmed chain results justify success UI. Return concise name/description and the minimum necessary changed files; retain unmodified contract bytes on frontend-only edits to preserve the deployed contract and its records.`;

const ASSET_INSTRUCTIONS = `Optional images: top-level "assets":[{"name":"hero","prompt":"specific image description","alt":"descriptive alternative text","aspectRatio":"16:9"}]. At most 2 images; ratios 1:1,16:9,9:16; name lowercase slug. Omitted assets inherit the existing list, [] removes them. Request images for visual concepts, hero artwork, illustrations, product imagery, and game art when they add meaning; avoid unnecessary images in dense data tools. Do not resend unchanged image prompts or embed image bytes/SVG/URLs in generated source. Import { Asset } from '@midnight-passport/assets'; render <Asset name="hero" className="hero-art"/>. The service generates and caches images alongside contract compilation. Use object-fit and intentional proportions; a built-in placeholder keeps the application functional if an image is unavailable. A revised prompt requests a new image. The coding model must focus on the requested behaviour and visual composition, using shared components for standard controls.`;

export function generationInstructions(brief: string, existing = false): string {
  // Existing source is the strongest reference during edits; avoid resending
  // both example contracts on every change to an already working application.
  return `${INSTRUCTIONS}\n\n${passportSkillContext}\n\n${ASSET_INSTRUCTIONS}\n\n${BOILERPLATE_INSTRUCTIONS}${existing ? '' : `\n\n${contractPatternInstructions(brief)}`}`;
}

export async function generate(project: Project, prompt: string, onProgress: (message: string) => void, onFiles?: (files: PartialGenerationFiles) => void) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('Set OPENROUTER_API_KEY in the service environment to generate apps.');
  const previous = Object.keys(project.files).length ? `Current application:\n${JSON.stringify(project.files)}\nCurrent image requests: ${JSON.stringify(project.assets?.map(({ name, prompt, alt, aspectRatio }) => ({ name, prompt, alt, aspectRatio })) || [])}\n` : '';
  const history = project.messages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
  const stream = modelTextStream({
    model: project.model,
    instructions: generationInstructions(`${history}\n${prompt}`, Object.keys(project.files).length > 0),
    prompt: `${previous}\nRecent discussion:\n${history}\nTask:\n${prompt}`,
  });
  return readGenerationStream(stream, onProgress, onFiles, {
    previousFiles: project.files,
    previousAssets: project.assets,
    onBoilerplate: () => onProgress('Using CRUD boilerplate with the generated customisations.'),
  });
}

/** Provider deltas are interpreted as JSON strings, never as executable files. */
export async function readGenerationStream(stream: AsyncIterable<string>, onProgress: (message: string) => void = () => {}, onFiles?: (files: PartialGenerationFiles) => void, context: GenerationContext = {}) {
  let text = '';
  const parser = new IncrementalGenerationParser();
  let nextProgress = 2000;
  for await (const delta of stream) {
    text += delta;
    if (text.length > 300_000) throw new Error('Model output exceeded the application size limit.');
    parser.push(delta);
    onFiles?.(parser.snapshot());
    if (text.length >= nextProgress) {
      onProgress(`Writing application files · ${Math.round(text.length / 1000)} kB received`);
      nextProgress += 6000;
    }
  }
  let counts = { supplied: 0, reused: 0, expanded: 0, defaulted: 0 };
  const generated = parseGeneration(text, { ...context, onResolvedFiles: value => { counts = value; context.onResolvedFiles?.(value); } });
  const inherited = counts.reused ? `reused ${counts.reused} unchanged files` : counts.expanded ? `expanded ${counts.expanded} boilerplate files` : counts.defaulted ? 'added empty default CSS' : 'reused 0 files';
  onProgress(`Model response: ${Buffer.byteLength(text, 'utf8')} bytes; supplied ${counts.supplied} file${counts.supplied === 1 ? '' : 's'}, ${inherited}.`);
  return generated;
}

export const counterStarter = {
  name: 'Community counter', description: 'A shared public counter on Midnight stage-net. Anyone can increment it, with each transaction approved in Passport.',
  files: {
    'contract.compact': 'pragma language_version >= 0.26;\nimport CompactStandardLibrary;\n\nexport ledger count: Counter;\n\nconstructor() {}\n\nexport circuit increment(): [] {\n  count.increment(1);\n}\n',
    'src/App.tsx': `import { useEffect, useState } from 'react';
import { usePassport } from '@midnight-passport/app';
export default function App() {
  const { profile, connected, connect, contractAddress, callContract, readLedger } = usePassport();
  const [count, setCount] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() { try { const state = await readLedger(); setCount(String(state.count ?? '0')); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } }
  useEffect(() => { if (contractAddress) void refresh(); }, [contractAddress]);
  async function increment() { setBusy(true); try { if (!connected) await connect(); const tx = await callContract('increment', [], 'Add one to the community counter'); setMessage('Submitted: ' + tx.txId + '. Waiting for the indexer.'); await refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  return <main><div className="network">Midnight · Stage-net</div><h1>A little action.<br/>A shared impact.</h1><p>A public counter, built together. Every increment is a transaction you approve with Midnight Passport.</p><section><span className="label">Community count</span><strong>{count ?? '—'}</strong><button onClick={increment} disabled={busy || !contractAddress}>{busy ? 'Waiting for Passport…' : 'Add your +1'}</button><button className="quiet" onClick={refresh} disabled={!contractAddress}>Refresh on-chain count</button></section><p className="caption">{!contractAddress ? 'Preview · Deploy this app to activate its contract.' : connected ? 'Connected as ' + (profile?.displayName || 'Passport user') : 'Your Passport will open when you participate.'}</p><output>{message}</output></main>;
}`,
    'src/styles.css': `*{box-sizing:border-box}body{margin:0;background:#f4f2eb;color:#20302b;font-family:system-ui,sans-serif}main{max-width:760px;padding:64px 28px;margin:auto}.network{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#597468}h1{font-size:clamp(36px,7vw,64px);line-height:1.08;letter-spacing:-.05em;font-weight:600;margin:28px 0}p{font-size:17px;line-height:1.65;color:#5c6960;max-width:570px}section{display:flex;align-items:center;flex-direction:column;gap:20px;background:white;padding:38px;margin:32px 0;border-radius:20px;border:1px solid #e0e5dc}.label{font-size:13px;color:#637368}strong{font-size:90px;font-weight:500;line-height:1.2;font-variant-numeric:tabular-nums}button{cursor:pointer;background:#2a5142;color:white;border:0;border-radius:9px;font:inherit;padding:14px 30px}button:disabled{opacity:.45;cursor:default}button.quiet{background:none;color:#3d6853;padding:5px}.caption{font-size:13px}output{display:block;font-size:13px;overflow-wrap:anywhere;color:#704724}`,
  },
};
