import { spawn } from 'node:child_process';
const build = spawn('node', ['scripts/build-runtime.mjs'], { stdio: 'inherit' });
await new Promise((resolve, reject) => build.on('exit', code => code === 0 ? resolve() : reject(new Error('Runtime build failed'))));
const children = [spawn('npm', ['run', 'dev:api'], { stdio: 'inherit' }), spawn('npm', ['run', 'dev:web'], { stdio: 'inherit' })];
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { children.forEach(child => child.kill(signal)); });
children.forEach(child => child.on('exit', code => { children.forEach(other => { if (other !== child) other.kill(); }); process.exitCode = code || 0; }));
