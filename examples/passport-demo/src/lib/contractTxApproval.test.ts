import { describe, expect, it } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { readFileSync } from 'node:fs';
import { assertRestrictedContractTransaction, assertSponsoredContractTransaction, contractRequestSourceMatches, inspectContractTransaction, type CheckedContractTransaction } from './contractTxApproval.js';

const now = Date.now();
const intent = { networkId: 'stagenet' as const, transaction: '00', contractAddress: 'ab'.repeat(32), entryPoint: 'increment', purpose: 'Add one vote' };

function transaction() {
  // The validator receives ledger objects, never these test records, in production.
  const call = Object.create(ledger.ContractCall.prototype);
  Object.defineProperties(call, { address: { value: intent.contractAddress }, entryPoint: { value: intent.entryPoint } });
  const part = { actions: [call], ttl: new Date(now + 120_000), guaranteedUnshieldedOffer: undefined as unknown, fallibleUnshieldedOffer: undefined as unknown, dustActions: undefined as unknown };
  const tx = { toString: () => 'StandardTransaction { network_id: "stagenet",', intents: new Map([[1, part]]), imbalances: () => new Map([['night', 0n]]), guaranteedOffer: undefined as unknown, fallibleOffer: new Map(), rewards: undefined as unknown };
  return { part, tx, checked: tx as unknown as CheckedContractTransaction };
}

describe('contract transaction approval boundary', () => {
  it('retains the real approved identity while accepting only fee additions', () => {
    const recorded = JSON.parse(readFileSync(new URL('./fixtures/stagenet-counter-call.json', import.meta.url), 'utf8'));
    const actual = { networkId: 'stagenet' as const, transaction: recorded.transaction, contractAddress: recorded.contractAddress, entryPoint: recorded.circuit, purpose: 'Increment the verification counter' };
    const instant = Date.parse('2026-09-14T16:20:00Z');
    const approved = inspectContractTransaction(actual, 'stagenet', instant);
    const bound = approved.bind();
    assertSponsoredContractTransaction(approved, bound, instant);
    // The fee sponsor appends an intent with DUST actions and no contract,
    // shielded, or unshielded actions. Keep the original ledger intent real.
    const fee = { actions: [], dustActions: {}, ttl: new Date(instant + 60_000) };
    const candidate = {
      toString: () => bound.toString(), identifiers: () => bound.identifiers(),
      intents: new Map<number, unknown>([...bound.intents!, [2, fee]]),
      rewards: undefined, guaranteedOffer: undefined, fallibleOffer: undefined,
    };
    assertSponsoredContractTransaction(approved, candidate as unknown as ledger.FinalizedTransaction, instant);
    assertSponsoredContractTransaction(approved, candidate as unknown as ledger.FinalizedTransaction, instant + 59_000);
    expect(() => assertSponsoredContractTransaction(approved, candidate as unknown as ledger.FinalizedTransaction, instant + 60_000)).toThrow(/expired/);
    const changed = { ...candidate, identifiers: () => ['different'] };
    expect(() => assertSponsoredContractTransaction(approved, changed as unknown as ledger.FinalizedTransaction, instant)).toThrow(/different transaction/);
    const addedCall = { ...candidate, intents: new Map<number, unknown>([...bound.intents!, [2, { ...fee, actions: [{}] }]]) };
    expect(() => assertSponsoredContractTransaction(approved, addedCall as unknown as ledger.FinalizedTransaction, instant)).toThrow(/unapproved contract action/);
    const asset = { ...candidate, intents: new Map<number, unknown>([...bound.intents!, [2, { ...fee, guaranteedUnshieldedOffer: {} }]]) };
    expect(() => assertSponsoredContractTransaction(approved, asset as unknown as ledger.FinalizedTransaction, instant)).toThrow(/unsupported asset transfer/);
    const changedIntent = { ...candidate, intents: new Map([...approved.intents!.keys()].map(segment => [segment, { intentHash: () => 'different' }])) };
    expect(() => assertSponsoredContractTransaction(approved, changedIntent as unknown as ledger.FinalizedTransaction, instant)).toThrow(/changed the approved/);
    const otherNetwork = { ...candidate, toString: () => 'StandardTransaction { network_id: "mainnet",' };
    expect(() => assertSponsoredContractTransaction(approved, otherNetwork as unknown as ledger.FinalizedTransaction, instant)).toThrow(/not a stagenet/);
    const shielded = { ...candidate, guaranteedOffer: {} };
    expect(() => assertSponsoredContractTransaction(approved, shielded as unknown as ledger.FinalizedTransaction, instant)).toThrow(/unsupported asset interaction/);
    expect(() => assertSponsoredContractTransaction(approved, { ...candidate, intents: undefined } as unknown as ledger.FinalizedTransaction, instant)).toThrow(/omitted/);
  });

  it('decodes a real proven counter call, and rejects swapped metadata or altered validity', () => {
    // Proved on 2026/09/14 against the counter deployed at stagenet block 460294.
    // This recorded proof contains no wallet or private-state secrets.
    const recorded = JSON.parse(readFileSync(new URL('./fixtures/stagenet-counter-call.json', import.meta.url), 'utf8'));
    const actual = { networkId: 'stagenet' as const, transaction: recorded.transaction, contractAddress: recorded.contractAddress, entryPoint: recorded.circuit, purpose: 'Increment the verification counter' };
    const instant = Date.parse('2026-09-14T16:20:00Z');
    const tx = inspectContractTransaction(actual, 'stagenet', instant);
    expect(tx.intents?.size).toBe(1);
    expect([...tx.intents!.values()][0]!.actions[0]).toBeInstanceOf(ledger.ContractCall);
    expect(() => inspectContractTransaction({ ...actual, entryPoint: 'withdraw' }, 'stagenet', instant)).toThrow(/different contract/);
    expect(() => inspectContractTransaction({ ...actual, contractAddress: '00'.repeat(32) }, 'stagenet', instant)).toThrow(/different contract/);
    expect(() => inspectContractTransaction(actual, 'stagenet', Date.parse('2026-09-14T18:00:00Z'))).toThrow(/expires/);
    expect(() => inspectContractTransaction(actual, 'stagenet', Date.parse('2026-09-14T16:00:00Z'))).toThrow(/excessive lifetime/);
    expect(() => inspectContractTransaction({ ...actual, transaction: actual.transaction.slice(0, -20) }, 'stagenet', instant)).toThrow();
  });

  it('requires both the owned window and the expected origin', () => {
    const source = {} as Window;
    const peer = { source, origin: 'https://app.example' };
    expect(contractRequestSourceMatches({ source, origin: 'https://app.example' }, { source: null, origin: null })).toBe(false);
    expect(contractRequestSourceMatches({ source, origin: 'https://app.example' }, { source, origin: null })).toBe(true);
    expect(contractRequestSourceMatches({ source, origin: peer.origin }, peer)).toBe(true);
    expect(contractRequestSourceMatches({ source: {} as Window, origin: peer.origin }, peer)).toBe(false);
    expect(contractRequestSourceMatches({ source, origin: 'https://evil.example' }, peer)).toBe(false);
    expect(contractRequestSourceMatches({ source, origin: 'null' }, { source, origin: null })).toBe(false);
    expect(contractRequestSourceMatches({ source, origin: 'javascript:alert(1)' }, { source, origin: null })).toBe(false);
    expect(contractRequestSourceMatches({ source, origin: 'malformed' }, { source, origin: null })).toBe(false);
  });

  it('checks the decoded call rather than the app description', () => {
    const { checked } = transaction();
    expect(() => assertRestrictedContractTransaction(checked, intent, now)).not.toThrow();
    expect(() => assertRestrictedContractTransaction(checked, { ...intent, contractAddress: 'cd'.repeat(32) }, now)).toThrow(/different contract/);
    expect(() => assertRestrictedContractTransaction(checked, { ...intent, entryPoint: 'drain' }, now)).toThrow(/different contract/);
  });

  it('rejects assets, fees, hidden calls, maintenance, and imbalances', () => {
    for (const field of ['guaranteedUnshieldedOffer', 'fallibleUnshieldedOffer', 'dustActions'] as const) {
      const { checked, part } = transaction(); part[field] = {};
      expect(() => assertRestrictedContractTransaction(checked, intent, now)).toThrow(/asset or fee/);
    }
    for (const field of ['guaranteedOffer', 'rewards'] as const) {
      const { checked, tx } = transaction(); tx[field] = {};
      expect(() => assertRestrictedContractTransaction(checked, intent, now)).toThrow(/Shielded/);
    }
    const extra = transaction(); extra.part.actions.push(extra.part.actions[0]);
    expect(() => assertRestrictedContractTransaction(extra.checked, intent, now)).toThrow(/Exactly one contract/);
    const maintenance = transaction(); maintenance.part.actions = [{}];
    expect(() => assertRestrictedContractTransaction(maintenance.checked, intent, now)).toThrow(/maintenance/);
    const deficit = transaction(); deficit.tx.imbalances = () => new Map([['night', -1n]]);
    expect(() => assertRestrictedContractTransaction(deficit.checked, intent, now)).toThrow(/asset transfer/);
  });

  it('rejects expired bytes, the wrong network, malformed bytes, and unproven payloads', () => {
    const expired = transaction(); expired.part.ttl = new Date(now);
    expect(() => assertRestrictedContractTransaction(expired.checked, intent, now)).toThrow(/expires/);
    const other = transaction(); other.tx.toString = () => 'StandardTransaction { network_id: "mainnet",';
    expect(() => assertRestrictedContractTransaction(other.checked, intent, now)).toThrow(/stagenet/);
    expect(() => inspectContractTransaction(intent, 'mainnet')).toThrow(/different network/);
    expect(() => inspectContractTransaction(intent, 'stagenet')).toThrow();
    const unproven = ledger.Transaction.fromParts('stagenet', undefined, undefined, ledger.Intent.new(new Date(now + 120_000)));
    const hex = Array.from(unproven.serialize(), b => b.toString(16).padStart(2, '0')).join('');
    expect(() => inspectContractTransaction({ ...intent, transaction: hex }, 'stagenet')).toThrow();
  });
});
