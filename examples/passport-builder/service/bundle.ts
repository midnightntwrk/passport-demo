import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { previewSupport } from '../runtime/preview-support.js';
import type { ProjectFiles } from '../shared/types.js';
import { checkApp } from './app-typecheck.js';
const require = createRequire(import.meta.url);
const runtimeClient = fileURLToPath(new URL('../runtime/client.tsx', import.meta.url));
const runtimeUi = fileURLToPath(new URL('../runtime/ui.tsx', import.meta.url));
const runtimeUiStyles = fileURLToPath(new URL('../runtime/ui-styles.ts', import.meta.url));
const packageDirectory = fileURLToPath(new URL('../', import.meta.url));

export async function bundleApp(files: ProjectFiles, images: Record<string, { src: string; alt: string }> = {}): Promise<string> {
  await checkApp(files['src/App.tsx']);
  const [clientSource, uiSource, uiStylesSource] = await Promise.all([readFile(runtimeClient, 'utf8'), readFile(runtimeUi, 'utf8'), readFile(runtimeUiStyles, 'utf8')]);
  const maintainedSources: Record<string, string> = { '@midnight-passport/app': clientSource, '@midnight-passport/ui': uiSource, 'ui-styles': uiStylesSource };
  maintainedSources['@midnight-passport/assets'] = `import React from 'react'; const images=${JSON.stringify(images)}; export function Asset({name,alt,...props}){const image=images[name]; return image ? <img {...props} src={image.src} alt={alt ?? image.alt} loading="lazy" decoding="async"/> : <div {...props} role="img" aria-label={alt || 'Image unavailable'} style={{aspectRatio:'16 / 9',background:'linear-gradient(135deg,#181b2b,#313c59)',...props.style}}/>; }`;
  const result = await build({
    stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import App from 'generated:app'; createRoot(document.getElementById('root')).render(<App/>);`, loader: 'tsx', resolveDir: packageDirectory },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true, jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', '__PASSPORT_HOST_ORIGIN__': 'window.__PASSPORT_HOST_ORIGIN__' },
    logLevel: 'silent',
    plugins: [{ name: 'maintained-passport-runtime', setup(plugin) {
      plugin.onResolve({ filter: /^generated:app$/ }, args => ({ path: args.path, namespace: 'generated' }));
      plugin.onResolve({ filter: /^@midnight-passport\/(app|ui|assets)$/ }, args => ({ path: args.path, namespace: 'maintained' }));
      plugin.onLoad({ filter: /.*/, namespace: 'generated' }, () => ({ contents: files['src/App.tsx'], loader: 'tsx', resolveDir: packageDirectory }));
      plugin.onLoad({ filter: /.*/, namespace: 'maintained' }, args => ({ contents: maintainedSources[args.path], loader: 'tsx', resolveDir: packageDirectory }));
      plugin.onResolve({ filter: /.*/, namespace: 'generated' }, args => {
        if (['react', 'react/jsx-runtime', 'lucide-react'].includes(args.path)) return { path: require.resolve(args.path) };
        return { errors: [{ text: `Generated apps may not import '${args.path}'. Use react, lucide-react, @midnight-passport/app, or @midnight-passport/ui.` }] };
      });
      plugin.onResolve({ filter: /.*/, namespace: 'maintained' }, args => {
        // Sibling imports are available only to this maintained module. Generated
        // source cannot use relative imports to enter the runtime or filesystem.
        if (args.importer === '@midnight-passport/ui' && ['./client', './ui-styles'].includes(args.path)) return { path: args.path === './client' ? '@midnight-passport/app' : 'ui-styles', namespace: 'maintained' };
        if (['react', 'react/jsx-runtime', 'lucide-react'].includes(args.path)) return { path: require.resolve(args.path) };
        return { errors: [{ text: `Unsupported maintained UI import '${args.path}'.` }] };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

export function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
export function scriptJson(value: unknown) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
export function sandboxDocument(bundle: string, css: string, hostOrigin: string) {
  const js = `Object.defineProperty(window,'__PASSPORT_HOST_ORIGIN__',{value:${scriptJson(hostOrigin)},writable:false,configurable:false});${previewSupport.replace('__HOST_ORIGIN__', scriptJson(hostOrigin))}\n${bundle}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';"><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

export function runtimeDocument(input: { passportReady?: boolean; id: string; name: string; passportOrigin: string; app: string; contractAddress?: string; deploymentId?: string; circuits: string[] }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.name)} · Passport</title><style>*{box-sizing:border-box}html,body{height:100%;margin:0;font-family:system-ui,sans-serif;background:#111;color:#eee}body{display:flex;flex-direction:column}header{min-height:58px;padding:10px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #333}header strong{font-size:14px}header span{color:#aaa;font-size:12px}header button{margin-left:auto;background:#f0ede8;color:#111;border:0;border-radius:7px;padding:10px 15px;cursor:pointer;font-weight:600}iframe{flex:1;width:100%;border:0;background:white}#notice{font-size:12px;padding:0 20px;overflow-wrap:anywhere}#notice:empty{display:none}#recovery{padding:0 20px 12px;font-size:12px}#recovery[hidden]{display:none}#recovery button{padding:8px 12px;margin-right:8px;cursor:pointer}dialog{color:#eee;background:#191919;border:1px solid #555;border-radius:12px;max-width:500px;padding:24px}dialog::backdrop{background:#000a}dialog p{overflow-wrap:anywhere;line-height:1.5}dialog button{padding:10px 16px;margin-right:8px;cursor:pointer}#approve{background:#e52321;color:white;border:0;border-radius:6px}</style></head><body><header><strong>${escapeHtml(input.name)}</strong><span>${input.contractAddress ? 'Stage-net' : 'Preview · not deployed'}</span><button id="connect">Connect Passport</button></header><p id="notice" role="status"></p><div id="recovery" hidden><button id="check-pending">Check transaction status</button><button id="clear-pending">Clear after review</button></div><iframe id="app" title="${escapeHtml(input.name)}" sandbox="allow-scripts allow-forms"></iframe><dialog id="approval"><h2 id="approval-title">Connect with Passport</h2><p id="approval-copy"></p><button id="approve">Continue to Passport</button><button id="cancel">Cancel</button></dialog><script id="runtime-data" type="application/json">${scriptJson(input)}</script><script type="module" src="/runtime/host.js"></script></body></html>`;
}
