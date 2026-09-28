import test from 'node:test';
import assert from 'node:assert/strict';
import { checkApp } from '../service/app-typecheck.js';

test('generated calls must match the maintained runtime before publication', async () => {
  const app = (args: string) => `import {usePassport} from '@midnight-passport/app'; export default function App(){ const {callContract}=usePassport(); return <button onClick={()=>void callContract('createOffer', ${args}, 'Create offer')}>Create</button>; }`;
  await assert.rejects(checkApp(app("{id:'1', label:'a', details:'b'}")), /src\/App.tsx.*(unknown\[\]|array|does not exist)/);
  await checkApp(app("['1','a','b']"));
  await assert.rejects(checkApp("import {usePassport} from '@midnight-passport/app'; export default function App(){const {signTransaction}=usePassport(); return <button onClick={signTransaction}>Save</button>}"), /signTransaction/);
});

test('generated types cannot bypass validation or resolve arbitrary service modules', async () => {
  await assert.rejects(checkApp('// @ts-nocheck\nexport default function App(){return <p/>}'), /disable typechecking/);
  await assert.rejects(checkApp("import {config} from './service/config'; export default function App(){return <p>{config}</p>}"), /may not import/);
  await assert.rejects(checkApp('/// <reference path="./service/config.ts"/>\nexport default function App(){return <p/>}'), /compiler references/);
});
