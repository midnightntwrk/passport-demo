import { readFileSync } from 'node:fs';
import type { ProjectFiles } from '../shared/types.js';

export type BoilerplateId = 'crud';
const CRUD_SOURCE = readFileSync(new URL('./patterns/crud-records.compact', import.meta.url), 'utf8');
const CRUD_EXAMPLE = {
  base: 'crud', name: 'Reading shelf', description: 'A public catalogue of titles and short notes; anyone can edit records.',
  files: { 'src/App.tsx': `import { CrudApp } from '@midnight-passport/ui'; export default function App(){return <CrudApp title="Reading shelf" itemName="book" labelName="Title" valueName="Note" />;}` },
};

/** A fresh file map each time; callers may overlay validated generated files. */
export function boilerplateFiles(base: BoilerplateId, metadata: { name: string; description: string }): ProjectFiles {
  if (base !== 'crud') throw new Error('Unknown application boilerplate.');
  return {
    'contract.compact': CRUD_SOURCE,
    'src/App.tsx': `import { CrudApp } from '@midnight-passport/ui';\nexport default function App() {\n  return <CrudApp title={${JSON.stringify(metadata.name)}} description={${JSON.stringify(metadata.description)}} />;\n}\n`,
    'src/styles.css': '',
  };
}

export const BOILERPLATE_INSTRUCTIONS = `Optional new-app base: "base":"crud" supplies a real Compact records Map<Uint<64>,{label:Bytes<32>,value:Bytes<32>}> and createRecord(recordId,label,value), updateRecord(recordId,label,value), deleteRecord(recordId). IDs are decimal strings; both text fields hold at most 32 UTF-8 bytes. The supplied CrudApp handles encoding, records, create/edit/delete forms, Passport approval, confirmation, refreshes, errors, and truncation. It uses public, permissionless records; it does not enforce ownership, unique-person identity, private data, or token transfers.
Choose this base explicitly ONLY for a new idea that actually fits a two-field CRUD directory/catalogue/registry. When it fits, prefer the base plus a small CrudApp override instead of regenerating its contract, forms, or CSS. Do not use it to replace a workflow, poll, game, or custom domain logic. A suitable response can be ${JSON.stringify(CRUD_EXAMPLE)}. Omit unchanged boilerplate contract and CSS. Empty files:{} uses the base's default App titled from name/description. If modifying the schema or circuits, provide the changed contract and compatible App; generic CrudApp requires exactly the documented schema. Existing apps must omit base and inherit their own unchanged files.`;
