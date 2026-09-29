import { Either } from 'effect';
import { Transacting, WalletError } from '@midnight-ntwrk/wallet-sdk/dust/v1';
import { getBalanceRecipe, Imbalances, InsufficientFundsError } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { MAX_DUST_INPUTS_CEILING } from './coinReservation.js';

/**
 * wallet-sdk-dust-wallet 5.0.0-beta.2 turns a negative deficit into a positive
 * imbalance after its first fee estimate. When the added inputs increase the
 * fee, it then selects no inputs forever inside Effect.runSync.
 *
 * Use the SDK's public capability hook. Keep its ledger fee calculation,
 * spending, proof generation, and our reservation/padding selector unchanged.
 * Grow the recipe by the remaining deficit, keeping inputs already reserved;
 * never restart selection or charge DUST that the original transaction pays.
 */
export class BoundedDustTransacting extends Transacting.TransactingCapabilityImplementation<never> {
  override computeBalancingRecipe(...args: Parameters<Transacting.TransactingCapabilityImplementation<never>['computeBalancingRecipe']>) {
    const [secretKey, state, transactions, ttl, now, params] = args;
    return Either.try({
      try: () => {
        const credit = transactions.reduce((sum, tx) => sum + Transacting.TransactingCapabilityImplementation.feeImbalance(tx, 0n), 0n);
        let totalFee = transactions.reduce((sum, tx) => sum + this.calculateFee(tx, params), 0n);
        const available = this.getCoins().getAvailableCoinsWithGeneratedDust(state, now);
        const selected: typeof available[number][] = [];
        const seen = new Set<bigint>();
        let coverage = 0n;
        for (let iteration = 0; iteration <= MAX_DUST_INPUTS_CEILING; iteration++) {
          const deficit = totalFee - credit - coverage;
          if (deficit > 0n) {
            const recipe = getBalanceRecipe({
              coins: available.filter(coin => !seen.has(coin.token.nonce)).map(coin => ({ ...coin, type: 'dust' })),
              initialImbalances: Imbalances.fromEntry('dust', -deficit),
              feeTokenType: 'dust',
              coinSelection: this.getCoinSelection(),
              transactionCostModel: { inputFeeOverhead: 0n, outputFeeOverhead: 0n },
              createOutput: coin => coin,
              isCoinEqual: (a, b) => a.token.nonce === b.token.nonce,
            });
            if (!recipe.inputs.length) throw new Error('DUST fee selection made no progress.');
            for (const input of recipe.inputs) {
              if (seen.has(input.token.nonce) || input.value <= 0n) throw new Error('Invalid DUST fee input.');
              seen.add(input.token.nonce);
              selected.push({ token: input.token, value: input.value });
              coverage += input.value;
              if (selected.length > MAX_DUST_INPUTS_CEILING) throw new Error('DUST fee input limit exceeded.');
            }
          }
          totalFee = this.dryRunFee(selected, transactions, secretKey, state, ttl, now, params);
          const required = totalFee > credit ? totalFee - credit : 0n;
          if (coverage >= required) {
            let remaining = required;
            return {
              fee: totalFee,
              recipeInputs: selected.map(input => {
                const value = input.value < remaining ? input.value : remaining;
                remaining -= value;
                return { ...input, value };
              }),
            };
          }
        }
        throw new Error('DUST fee calculation did not converge within the input limit.');
      },
      catch: cause => cause instanceof InsufficientFundsError
        ? new WalletError.InsufficientFundsError({ message: cause.message, tokenType: cause.tokenType })
        : new WalletError.OtherWalletError({ message: cause instanceof Error ? cause.message : 'DUST balancing failed.', cause }),
    });
  }
}

export const boundedDustTransacting = (config: Transacting.DefaultTransactingConfiguration, context: () => Transacting.DefaultTransactingContext) =>
  new BoundedDustTransacting(config.networkId, config.costParameters, () => context().coinSelection, () => context().coinsAndBalancesCapability, () => context().keysCapability);
