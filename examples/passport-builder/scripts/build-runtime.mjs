import { build } from 'esbuild';
await build({ entryPoints: ['runtime/host.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, outfile: 'public/runtime.js' });
