import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acceptsPassportCapabilities } from '../service/passport-readiness.js';
const capabilities = JSON.parse(readFileSync(new URL('../../passport-demo/public/passport-capabilities.json', import.meta.url), 'utf8'));
test('app readiness requires deployed custody sign-in and contract approval capabilities', () => {
  assert.equal(acceptsPassportCapabilities(capabilities), true);
  for (const value of [undefined, {}, '<html>Old Passport</html>', { ...capabilities, networks: ['mainnet'] }, { ...capabilities, profile: { popup: true } }, { ...capabilities, contracts: { ...capabilities.contracts, approval: false } }]) assert.equal(acceptsPassportCapabilities(value), false);
});
