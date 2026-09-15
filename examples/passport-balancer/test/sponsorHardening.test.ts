/**
 * What a refusal is allowed to say, and what the committed deploy files must
 * carry.
 *
 * TWO THINGS ARE PINNED HERE, and they have the same root.
 *
 * THE FIRST IS THE SENTENCE. Every string this service puts in a refusal's
 * `message` or `detail` is rendered by the app, verbatim, to somebody who is
 * mid-send and is not an operator. Two of them had stopped being sentences: the
 * `funder-empty` refusal published this service's own funding address and told
 * the reader to visit a faucet, and the `indexer-unreachable` refusal on
 * `/fund-account` echoed a 64-hex contract address and whatever the indexer
 * client threw. Neither is something the reader can act on, and both are
 * internals on a stranger's screen. The remedy is not to soften the words: it is
 * to send the operator's half to the journal and to `/status`, where operators
 * look, and leave the reader one plain sentence. The test below reads the
 * SOURCE, because the thing being asserted is that no interpolation creeps back
 * into these two strings — which a test of the returned object would not see
 * until it had a wallet, an indexer, and a failing one of each.
 *
 * THE SECOND IS THE DEPLOY FILES, for the same reason a test exists at all:
 * both of these were true on the droplet and untrue in the repository, which is
 * the state a rebuild from the repository silently undoes.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DEFAULT_ALLOWED_ORIGINS } from '../src/config.js';

/* Resolved from this file rather than from the working directory: the tests are
   bundled to `dist/test/` and run from the package root. */
const packageRoot = join(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(packageRoot, ...parts), 'utf8');

const serverSource = read('src', 'server.ts');
const unit = read('deploy', 'passport-balancer.service');
const caddy = read('deploy', 'Caddyfile.stagenet');

describe('what a refused caller is told', () => {
  it('says the fee service is out of funds, and says nothing else', () => {
    assert.ok(
      serverSource.includes(
        "'The service that covers fees is out of funds right now. Try again later.'",
      ),
      'the fixed sentence is the whole of the `funder-empty` message',
    );
  });

  it('no longer hands the reader an address or a faucet', () => {
    /* The exact strings the old sentence was built from. A `message` is the
       only place either could reach a screen, so their absence from the
       refusals is the assertion. */
    for (const refused of refusalStrings(serverSource)) {
      assert.ok(
        !/wallet\.address|config\.networkId} faucet|faucet \$\{/.test(refused),
        `a refusal still names an address or a faucet: ${refused.slice(0, 120)}`,
      );
    }
  });

  it('tells the reader a Passport could not be checked, without saying what it is', () => {
    assert.ok(
      serverSource.includes(
        "'This Passport could not be checked right now. Try again shortly.'",
      ),
      'the fixed sentence for an unreadable account',
    );
    assert.ok(
      serverSource.includes("detail: 'The service that reads accounts did not answer.'"),
      '`detail` is a sentence too — the app renders it in several places',
    );
  });

  it('puts the contract address and the raw cause in the journal instead', () => {
    assert.ok(
      /console\.warn\(\s*`\[account\] the account contract \$\{contractAddress\} could not be read: /.test(
        serverSource,
      ),
      'the operator still gets the address and the cause, on the log line',
    );
  });

  it('puts no raw exception into `funder-empty` or the account-read refusal', () => {
    /* Scoped to the two refusals this change is about. The register-alias gate
       next door has the same defect — `registry-unreachable` still echoes a
       contract address and a cause — and is deliberately untouched here because
       an open pull request is editing the gates either side of it. */
    for (const site of [
      /'funder-empty',\s*\n\s*([^\n]+)/,
      /'indexer-unreachable',\s*'([^']+)'/,
    ]) {
      const found = serverSource.match(site);
      assert.ok(found, `the refusal has moved: ${String(site)}`);
      const message = found?.[1] ?? '';
      assert.ok(
        !/\$\{/.test(message),
        `a fixed sentence has grown an interpolation: ${message.slice(0, 120)}`,
      );
    }
  });
});

describe('the operator half, where operators look', () => {
  it('`/status` carries the address to top up and the instruction for doing it', () => {
    assert.ok(serverSource.includes('topUp: {'), '`/status` publishes the top-up fields');
    assert.ok(
      /topUp: \{[\s\S]{0,400}?address: wallet\.address/.test(serverSource),
      'the address is on `/status`, not in the refusal',
    );
    assert.ok(
      /topUp: \{[\s\S]{0,400}?top this address up from the \$\{config\.networkId\} faucet/.test(
        serverSource,
      ),
      'and so is the faucet instruction',
    );
  });
});

describe('the committed deploy files, against the running droplet', () => {
  it('admits staging, which is where every build lands first', () => {
    assert.ok(
      DEFAULT_ALLOWED_ORIGINS.includes('https://staging.midnightpassport.com'),
      'the built-in default admits staging',
    );
    assert.ok(
      DEFAULT_ALLOWED_ORIGINS.includes('https://midnightpassport.com'),
      'and still admits production',
    );
    assert.ok(
      /^Environment=BALANCER_ALLOWED_ORIGINS=.*https:\/\/staging\.midnightpassport\.com/m.test(unit),
      'and so does the unit the droplet is installed from',
    );
  });

  it('cannot end a fast-failing start in `start-limit-hit`', () => {
    /* `Restart=always` is what makes the health loop's last-resort rung a
       remedy. systemd's default start limit — five starts in ten seconds —
       overrides it for exactly the failure that needs it most, and leaves the
       unit `failed` until somebody runs `reset-failed` by hand. */
    const unitSection = unit.slice(unit.indexOf('[Unit]'), unit.indexOf('[Service]'));
    assert.match(unitSection, /^StartLimitIntervalSec=0$/m, 'and it is in `[Unit]`, not `[Service]`');
    assert.match(unit, /^Restart=always$/m, 'the setting it protects is still there');
  });

  it('serves the sslip.io name and no name that points somewhere else', () => {
    /* funder.midnightpassport.com still resolves to the address of the 1 GB
       droplet deleted on 2026/08/27, which was handed on to somebody else. A
       site address Caddy cannot obtain a certificate for is retried on every
       reload. */
    const siteAddress = caddy
      .split('\n')
      .find((line) => line.includes('sslip.io {') && !line.trimStart().startsWith('#'));
    assert.ok(siteAddress, 'the public site block is still there');
    assert.equal(siteAddress?.trim(), '67-205-177-162.sslip.io {');
    assert.ok(
      !/^\s*[^#\n]*funder\.midnightpassport\.com[^\n]*\{/m.test(caddy),
      'and no site block names the recycled host',
    );
  });

  it('leaves exactly one Caddy config in the repository', () => {
    /* The deleted `deploy/Caddyfile` was a stale subset of this one — the same
       proxy without the gateway upstream — which is a worse thing for a
       deployer to find than no file at all. */
    assert.ok(!existsSync(join(packageRoot, 'deploy', 'Caddyfile')), 'the stale subset is gone');
    assert.ok(existsSync(join(packageRoot, 'deploy', 'Caddyfile.stagenet')));
  });
});

/**
 * Every string this service passes to `refusal(...)` as its user-facing
 * `message`, read out of the source.
 *
 * Crude on purpose: it takes the third argument of each `refusal(` call, which
 * is the field the app renders, and it would rather over-collect than miss one.
 */
function refusalStrings(source: string): string[] {
  const found: string[] = [];
  const calls = source.matchAll(/\brefusal\(\s*\n?\s*\d{3},\s*\n?\s*'[^']+',\s*\n?\s*([\s\S]{0,400}?),\n?\s*\)/g);
  for (const call of calls) {
    const message = call[1];
    if (message) found.push(message);
  }
  assert.ok(found.length > 10, `only ${found.length} refusals found — the reader has drifted`);
  return found;
}
