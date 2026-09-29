import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Either } from 'effect';
import { WalletError } from '@midnight-ntwrk/wallet-sdk/dust/v1';
import { BoundedDustTransacting } from '../src/dustTransacting.js';

function fixture(values: bigint[], fee: (inputs: readonly { value: bigint }[]) => bigint, credit = 0n) {
  const coins = values.map((value, i) => ({ token: { nonce: BigInt(i + 1) }, value }));
  const deficits: bigint[] = [];
  const used = new Set<bigint>();
  const capability = new BoundedDustTransacting('stagenet', {} as never, () => ((available: typeof coins, _type: string, amount: bigint) => {
    deficits.push(amount);
    const coin = available.find(candidate => !used.has(candidate.token.nonce));
    if (coin) used.add(coin.token.nonce);
    return coin;
  }) as never, () => ({ getAvailableCoinsWithGeneratedDust: () => coins }) as never, () => ({} as never));
  capability.calculateFee = () => 10n;
  capability.dryRunFee = inputs => fee(inputs);
  const tx = { imbalances: (_segment: number, charge: bigint) => new Map([[{ tag: 'dust' }, credit - charge]]) };
  return { deficits, solve: () => capability.computeBalancingRecipe({} as never, {} as never, [tx] as never, new Date(), new Date(), {} as never) };
}

test('a growing fee keeps reserved inputs and selects the remaining deficit with the correct sign', () => {
  const recipes: bigint[][] = [];
  const f = fixture([6n, 4n, 100n], inputs => { recipes.push(inputs.map(input => input.value)); return 20n; });
  const result = f.solve();
  assert.ok(Either.isRight(result));
  assert.deepEqual(recipes, [[6n, 4n], [6n, 4n, 100n]]);
  assert.deepEqual(result.right.recipeInputs.map(input => input.value), [6n, 4n, 10n]);
  assert.equal(result.right.fee, 20n);
  assert.ok(f.deficits.every(deficit => deficit < 0n));
});

test('fees already contributed by the original transaction are not charged twice', () => {
  const result = fixture([100n], () => 20n, 7n).solve();
  assert.ok(Either.isRight(result));
  assert.equal(result.right.recipeInputs[0].value, 13n);
});

test('insufficient funds remain a typed wallet error, and return without looping', () => {
  const result = fixture([10n], () => 20n).solve();
  assert.ok(Either.isLeft(result));
  assert.ok(result.left instanceof WalletError.InsufficientFundsError);
});

test('pathological fee growth has a finite input/iteration limit', () => {
  let estimates = 0;
  const result = fixture(Array.from({ length: 20 }, () => 10n), inputs => { estimates++; return BigInt(inputs.length + 1) * 10n; }).solve();
  assert.ok(Either.isLeft(result));
  assert.match(result.left.message, /limit/);
  assert.ok(estimates <= 12);
});

test('ledger fee refusal preserves its cause for the padding policy', () => {
  const refusal = new Error('time to dismiss exceeded');
  const result = fixture([100n], () => { throw refusal; }).solve();
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.cause, refusal);
});
