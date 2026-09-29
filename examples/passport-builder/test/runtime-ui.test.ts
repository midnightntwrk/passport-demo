import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { bundleApp } from '../service/bundle.js';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const app = (source: string) => ({ 'contract.compact': '', 'src/App.tsx': source, 'src/styles.css': '' });

test('maintained CRUD bundles its styles only when imported and generated imports stay restricted', async () => {
  const shared = await bundleApp(app("import { CrudApp } from '@midnight-passport/ui'; export default function App(){return <CrudApp title=\"Directory\"/>}"));
  assert.match(shared, /--ui-bg:#0b0e14/);
  assert.match(shared, /createRecord/);
  assert.match(shared, /updateRecord/);
  assert.match(shared, /deleteRecord/);
  const custom = await bundleApp(app('export default function App(){return <h1>Custom layout</h1>}'));
  assert.doesNotMatch(custom, /--ui-bg:#0b0e14/);
  for (const path of ['./ui-styles', '../runtime/ui', '@midnight-passport/ui/styles', 'node:fs', 'https://example.com/ui.js']) {
    await assert.rejects(bundleApp(app(`import value from ${JSON.stringify(path)}; export default function App(){return <p>{String(value)}</p>}`)), /may not import/);
  }
});

test('CRUD wire values retain Uint64 precision, UTF-8 limits, Map shape, and honest initial rendering', async () => {
  const result = await build({
    stdin: { contents: `
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { CrudApp, normaliseRecordId, encodeRecordText, parseRecords } from './runtime/ui';
      export { normaliseRecordId, encodeRecordText, parseRecords };
      export const render = () => renderToStaticMarkup(createElement(CrudApp, { title: 'Directory' }));
    `, resolveDir: root, loader: 'tsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react-dom/server'], logLevel: 'silent',
    plugins: [{ name: 'fixture-passport-state', setup(plugin) {
      plugin.onResolve({ filter: /^\.\/client$/ }, () => ({ path: 'fixture-client', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export function usePassport(){return {connected:false,connecting:false,transacting:false,ledgerVersion:0,readLedger:async()=>({}),connect:async()=>({}),callContract:async()=>({status:'submitted',txId:'fixture'}),waitForTransaction:async()=>({status:'confirmed',txId:'fixture'})}}" }));
    } }],
  });
  const module = { exports: {} as any };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require, TextEncoder, TextDecoder, Uint8Array, console });
  const ui = module.exports;
  assert.equal(ui.normaliseRecordId('0007'), '7');
  assert.equal(ui.normaliseRecordId('18446744073709551615'), '18446744073709551615');
  for (const value of ['18446744073709551616', '-1', '1.5', '1e5']) assert.throws(() => ui.normaliseRecordId(value), /integer/);
  assert.equal(ui.encodeRecordText('é'.repeat(16)).length, 64);
  assert.throws(() => ui.encodeRecordText('é'.repeat(17)), /32 UTF-8 bytes/);
  assert.equal(ui.encodeRecordText(''), '00'.repeat(32));
  const parsed = ui.parseRecords({ records: { entries: [['9007199254740993', { label: ui.encodeRecordText('Béta'), value: ui.encodeRecordText('') }], ['7', { label: ui.encodeRecordText('First'), value: ui.encodeRecordText('Value') }]], size: '201', truncated: true } });
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { items: [{ id: '7', label: 'First', value: 'Value' }, { id: '9007199254740993', label: 'Béta', value: '' }], size: '201', truncated: true });
  assert.throws(() => ui.parseRecords({}), /expected records ledger/);
  assert.throws(() => ui.parseRecords({ records: { entries: [['1', { label: 'bad', value: 'bad' }]], size: '1', truncated: false } }), /invalid record field/);
  const binary = ui.parseRecords({ records: { entries: [['1', { label: 'ff'.repeat(32), value: ui.encodeRecordText('text') }]], size: '1', truncated: false } });
  assert.equal(binary.items[0].label, '0x' + 'ff'.repeat(32));
  const html = ui.render();
  assert.match(html, /This is a preview/);
  assert.match(html, /Connect Passport/);
  assert.match(html, /Any participant can create, update, or delete/);
  // Shared UI also works in hosts without allow-forms; keep its explicit
  // button handler independent of native form submission.
  assert.doesNotMatch(html, /type="submit"/);
  assert.match(html, /<button[^>]*type="button"[^>]*>Create record<\/button>/);
  assert.doesNotMatch(html, /0 stored|No records yet/);
});
