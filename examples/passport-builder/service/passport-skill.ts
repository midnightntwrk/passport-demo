import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const lock = JSON.parse(readFileSync(new URL('../passport-skill.lock.json', import.meta.url), 'utf8'));
const skill = readFileSync(new URL('../../../skills/midnight-passport/SKILL.md', import.meta.url), 'utf8');
if (createHash('sha256').update(skill).digest('hex') !== lock.sha256) throw new Error('The Passport agent skill does not match its reviewed pin.');
function section(start: string, end?: string) {
  const from = skill.indexOf(start);
  if (from < 0) throw new Error(`Missing pinned Passport skill section: ${start}`);
  const to = end ? skill.indexOf(end, from + start.length) : skill.length;
  if (to < 0) throw new Error(`Missing Passport skill section boundary: ${end}`);
  return skill.slice(from, to).trim();
}

/** Relevant, exact excerpts keep the skill useful without resending 69 kB of setup instructions. */
export const passportSkillContext = `Passport agent skill, PR #118, pinned ${lock.commit}:
${section('# Building on Midnight Passport', 'Deployed Passports:')}
${section('## Ground truth', '## What exists')}
${section('## Never')}

Builder capability overlay, implemented in this checkout:
The upstream skill describes stock v5.0. This builder ships a maintained, versioned contract-tx/v1 extension, custody profile consent, and a signed redirect bridge. Generated apps use ONLY the usePassport runtime documented above; do not generate Passport protocol handling, key derivation, or requests for arbitrary signing. The host independently checks the actual stage-net contract address and circuit, prohibits asset/value movements, asks for fresh approval, and verifies the sponsor preserved the approved call. This supports public-state, witness-free Compact contracts. It does not provide custody spending, arbitrary private state, or authenticated on-chain ownership. Passport identity is not proof of contract ownership. State and transaction outcomes must remain honest. Sign-in and approvals share the same configured Passport origin. No asset provider or AI credential is sent to an app.`;

export const passportSkillVersion = { commit: lock.commit as string, checkedAgainst: lock.checkedAgainst as string };
