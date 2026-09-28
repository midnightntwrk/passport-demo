import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function check(code: string, env: Record<string, string>) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { publicOrigin, assertRequestOrigin } from './service/origins.ts';
    import { assertConfiguration, devMode } from './service/config.ts';
    ${code}
  `], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
    env: { ...process.env, BUILDER_DEV_MODE: 'false', BUILDER_PUBLIC_URL: '', BUILDER_ALLOWED_ORIGINS: '',
      BUILDER_ACCESS_TOKEN: '', PASSPORT_ORIGIN: 'https://midnightpassport.com',
      PASSPORT_AUTH_ORIGIN: 'https://midnightpassport.com', BUILDER_NETWORK: 'stagenet', ...env },
  });
  assert.equal(result.status, 0, result.stderr);
}

test('production uses each trusted domain for callbacks and rejects forged hosts and cross-origin writes', () => {
  check(`
    assertConfiguration();
    for (const host of ['builder.midnightpassport.com', 'builder-production-14ef.up.railway.app']) {
      const req = { headers: { host, origin: 'https://' + host } };
      assert.equal(publicOrigin(req), 'https://' + host);
      assertRequestOrigin(req);
      assert.throws(() => assertRequestOrigin({ headers: { host } }), /same origin/);
      assert.throws(() => assertRequestOrigin({ headers: { host, origin: 'https://attacker.example' } }), /same origin/);
    }
    for (const host of ['attacker.example', 'localhost:3001', 'builder.midnightpassport.com@attacker.example', 'builder.midnightpassport.com/path', 'builder.midnightpassport.com:444']) {
      assert.throws(() => publicOrigin({ headers: { host, 'x-forwarded-host': 'builder.midnightpassport.com' } }), /Unrecognised/);
    }
  `, { NODE_ENV: 'production', BUILDER_PUBLIC_URL: 'https://builder-production-14ef.up.railway.app', BUILDER_ALLOWED_ORIGINS: 'https://builder.midnightpassport.com' });
});

test('normal local development still requires a matching browser origin', () => {
  check(`
    assertConfiguration(); assert.equal(devMode, false);
    const host = 'localhost:5188';
    assert.equal(publicOrigin({ headers: { host } }), 'http://' + host);
    assertRequestOrigin({ headers: { host, origin: 'http://' + host } });
    assert.throws(() => assertRequestOrigin({ headers: { host } }), /same origin/);
    assert.throws(() => publicOrigin({ headers: { host: 'attacker.example' } }), /Unrecognised/);
  `, { NODE_ENV: 'development' });
});

test('explicit dev bypass accepts only loopback requests without Origin', () => {
  check(`
    assertConfiguration(); assert.equal(devMode, true);
    for (const host of ['localhost:5188', '127.0.0.1:5189', '[::1]:5189']) assertRequestOrigin({ headers: { host } });
    assert.throws(() => assertRequestOrigin({ headers: { host: 'localhost:5188', origin: 'null' } }), /same origin/);
    assert.throws(() => assertRequestOrigin({ headers: { host: 'builder.midnightpassport.com' } }), /same origin/);
  `, { NODE_ENV: 'development', BUILDER_DEV_MODE: 'true', BUILDER_ALLOWED_ORIGINS: 'https://builder.midnightpassport.com' });
});

test('production refuses the dev bypass and requires configured public origins', () => {
  check(`assert.throws(assertConfiguration, /local development/);`, { NODE_ENV: 'production', BUILDER_DEV_MODE: 'true', BUILDER_PUBLIC_URL: 'https://builder.midnightpassport.com' });
  check(`assert.throws(assertConfiguration, /trusted BUILDER_PUBLIC_URL/);`, { NODE_ENV: 'production' });
  check(`assert.throws(assertConfiguration, /same Passport origin/);`, { NODE_ENV: 'production', BUILDER_PUBLIC_URL: 'https://builder.midnightpassport.com', PASSPORT_AUTH_ORIGIN: 'https://another-passport.example' });
  check(`assert.throws(assertConfiguration, /stage-net only/);`, { NODE_ENV: 'development', BUILDER_NETWORK: 'preprod' });
});
