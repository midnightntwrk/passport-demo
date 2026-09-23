/**
 * A CUSTODY PASSPORT ON THE REAL HOME, DRILLED.
 *
 * Every case here is either money reported wrong on the one screen a person
 * reads it from, a history that is missing or written twice, or a sentence
 * carrying a word its reader never asked to meet.
 */

import { describe, expect, it } from 'vitest';

import { MUSD_COLOUR_HEX, NIGHT_COLOUR_HEX } from './colour.js';
import { custodyOpeningDepositTxHash,
  CUSTODY_NIGHT_SEND_REFUSAL,
  CUSTODY_OLDER_ACCOUNT_REFUSAL,
  CUSTODY_OLDER_NAME_REFUSAL,
  custodyRecipientAccountRefusal,
  custodySentToastTitle,
  custodyActivityMarkKey,
  custodyHomeAccount,
  custodyHomeAliasRecord,
  custodyHomeContractRecord,
  custodyHomePendingBalances,
  custodyHomeRows,
  custodyHomeSendableHoldings,
  custodyMilestoneEntry,
  custodyMilestoneTxHash,
  custodyMilestonesLanded,
  custodySendPhase,
  custodySentEntry,
  custodyStablecoinHeld,
  type CustodyHoldings,
  type CustodyMilestone,
} from './custodyHome.js';

const OTHER_COLOUR = 'cd'.repeat(32);
const ACCOUNT = 'ab'.repeat(32);

function holdings(over: Partial<CustodyHoldings> = {}): CustodyHoldings {
  return {
    night: 2_000n,
    shielded: [{ colourHex: MUSD_COLOUR_HEX, amount: 100n }],
    balanceFailed: false,
    stablecoinColourHex: MUSD_COLOUR_HEX,
    arriving: 0,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* What the Passport holds                                                    */
/* -------------------------------------------------------------------------- */

describe('what Home is told a custody Passport holds', () => {
  it('quotes NIGHT on its own scale and the stablecoin on its own', () => {
    const account = custodyHomeAccount(holdings());
    /* Six decimal places for NIGHT, none for a shielded colour — the two
       mistakes this guards are a figure a million times too big and one a
       million times too small. */
    expect(account.nightBalance).toBe('0.002');
    expect(account.stablecoin).toEqual({
      symbol: 'mUSD',
      colourHex: MUSD_COLOUR_HEX,
      amount: 100n,
    });
    expect(account.status).toBe('ready');
  });

  it('keeps the stablecoin row at zero before any payment has landed', () => {
    /* The row belongs on screen either way: a Passport that has been paid and
       whose description has not arrived would otherwise show no sign of the
       token at all. */
    const account = custodyHomeAccount(holdings({ shielded: [] }));
    expect(account.stablecoin).toEqual({
      symbol: 'mUSD',
      colourHex: MUSD_COLOUR_HEX,
      amount: 0n,
    });
  });

  it('lists every other colour behind the stablecoin, and never twice', () => {
    const account = custodyHomeAccount(
      holdings({
        shielded: [
          { colourHex: OTHER_COLOUR, amount: 7n },
          { colourHex: MUSD_COLOUR_HEX, amount: 40n },
          { colourHex: MUSD_COLOUR_HEX, amount: 2n },
        ],
      }),
    );
    expect(account.stablecoin?.amount).toBe(42n);
    expect(account.otherShielded).toEqual([{ colourHex: OTHER_COLOUR, amount: 7n }]);
  });

  it('says a read has not happened, and says a read that failed differently', () => {
    expect(custodyHomeAccount(holdings({ night: null })).status).toBe('loading');
    expect(custodyHomeAccount(holdings({ night: null })).nightBalance).toBeNull();
    /* A failed read shown as a zero is the one answer that would be a lie, so
       it outranks everything — including a figure already in hand. */
    expect(custodyHomeAccount(holdings({ balanceFailed: true })).status).toBe('unavailable');
  });

  it('puts NIGHT first, which is the order every other balance list uses', () => {
    const rows = custodyHomeRows(holdings({ shielded: [{ colourHex: OTHER_COLOUR, amount: 5n }] }));
    expect(rows[0].colourHex).toBe(NIGHT_COLOUR_HEX);
    expect(rows.map((row) => row.mode)).toEqual(['unshielded', 'shielded', 'shielded']);
  });
});

describe('what the Send picker may offer', () => {
  it('offers the shielded colours it really holds and nothing else', () => {
    expect(
      custodyHomeSendableHoldings(
        holdings({
          shielded: [
            { colourHex: MUSD_COLOUR_HEX, amount: 40n },
            { colourHex: OTHER_COLOUR, amount: 3n },
          ],
        }),
      ),
    ).toEqual([
      { tokenType: MUSD_COLOUR_HEX, amount: 40n },
      { tokenType: OTHER_COLOUR, amount: 3n },
    ]);
  });

  it('never offers NIGHT, which this Passport cannot pay out', () => {
    const offered = custodyHomeSendableHoldings(holdings());
    expect(offered.some((row) => row.tokenType === NIGHT_COLOUR_HEX)).toBe(false);
  });

  it('never offers a row at zero', () => {
    expect(custodyHomeSendableHoldings(holdings({ shielded: [] }))).toEqual([]);
  });
});

describe('the word under a figure that has not settled', () => {
  it('says nothing at all when nothing is on its way', () => {
    expect(custodyHomePendingBalances(holdings()).size).toBe(0);
  });

  it('marks the shielded rows arriving, and paints the figure they already have', () => {
    const notes = custodyHomePendingBalances(holdings({ arriving: 2 }));
    expect(notes.get(MUSD_COLOUR_HEX)).toEqual({ value: '100', state: 'arriving' });
    /* NIGHT arrives on the account's own mirror. There is no queue behind it
       for a word to be about, so it never carries one. */
    expect(notes.has(NIGHT_COLOUR_HEX)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The name card and the line under it                                        */
/* -------------------------------------------------------------------------- */

describe('the name card', () => {
  it('reports a held name as registered, pointing at this Passport', () => {
    const record = custodyHomeAliasRecord({
      name: 'walker',
      network: 'stagenet',
      accountAddress: ACCOUNT,
    });
    expect(record).toMatchObject({
      alias: 'walker',
      domain: 'walker.night',
      status: 'registered',
      resolverTarget: 'contract',
      resolverTargetHex: ACCOUNT,
      registryConfirmed: true,
    });
  });

  it('is absent where there is no name, rather than empty', () => {
    expect(custodyHomeAliasRecord({ name: null, network: 'stagenet', accountAddress: ACCOUNT })).toBeNull();
    expect(custodyHomeAliasRecord({ name: '  ', network: 'stagenet', accountAddress: ACCOUNT })).toBeNull();
  });
});

describe('"Your account is ready"', () => {
  it('is said, with the address Receive offers, once every step has landed', () => {
    const record = custodyHomeContractRecord({
      accountAddress: ACCOUNT,
      network: 'stagenet',
      ready: true,
      user: 'jubjub:2a1f',
    });
    expect(record).toMatchObject({ status: 'deployed', address: ACCOUNT, ledgerConfirmed: true });
  });

  it('says nothing while a setup is still running', () => {
    /* The card renders nothing at all for a null, which is right: the step that
       makes the account exist is on screen at the time. */
    expect(
      custodyHomeContractRecord({
        accountAddress: ACCOUNT,
        network: 'stagenet',
        ready: false,
        user: 'jubjub:2a1f',
      }),
    ).toBeNull();
    expect(
      custodyHomeContractRecord({
        accountAddress: null,
        network: 'stagenet',
        ready: true,
        user: 'jubjub:2a1f',
      }),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The trail                                                                  */
/* -------------------------------------------------------------------------- */

describe('which rows the trail is owed', () => {
  const nothing = {
    written: [],
    hasAccount: false,
    activated: false,
    name: null,
    night: null,
    stablecoin: null,
  } as const;

  it('owes nothing about a Passport that does not exist yet', () => {
    expect(custodyMilestonesLanded(nothing)).toEqual([]);
  });

  it('lays a whole finished Passport down in the order it happened', () => {
    expect(
      custodyMilestonesLanded({
        written: [],
        hasAccount: true,
        activated: true,
        name: 'walker',
        night: 2_000n,
        stablecoin: 100n,
      }),
    ).toEqual<CustodyMilestone[]>([
      'created',
      'activated',
      'named',
      'opening-night',
      'opening-stablecoin',
    ]);
  });

  it('owes nothing twice, however many times the screen reads', () => {
    const reading = {
      written: ['created', 'activated', 'named'],
      hasAccount: true,
      activated: true,
      name: 'walker',
      night: 0n,
      stablecoin: 0n,
    };
    expect(custodyMilestonesLanded(reading)).toEqual([]);
    /* And the deposit that lands later is still owed when it does. */
    expect(custodyMilestonesLanded({ ...reading, night: 2_000n })).toEqual(['opening-night']);
  });

  it('owes nothing on a balance nobody has read', () => {
    /* `null` is "not read"; `0n` is "read, and nothing arrived". Treating the
       first as the second would write "your opening balance arrived" about
       money that has not. */
    expect(
      custodyMilestonesLanded({
        written: ['created', 'activated', 'named'],
        hasAccount: true,
        activated: true,
        name: 'walker',
        night: null,
        stablecoin: null,
      }),
    ).toEqual([]);
  });

  it('does not claim the key is on merely because an account exists', () => {
    expect(
      custodyMilestonesLanded({ ...nothing, hasAccount: true }),
    ).toEqual(['created']);
  });
});

describe('what each row says', () => {
  it('names the five milestones in the words Home paints', () => {
    expect(custodyMilestoneEntry('created').label).toBe('Passport created');
    expect(custodyMilestoneEntry('activated').label).toBe('Your account is set up');
    expect(custodyMilestoneEntry('named', { name: 'walker' })).toMatchObject({
      label: 'Your name is registered',
      detail: 'walker.night now points at your Passport.',
    });
    expect(custodyMilestoneEntry('opening-night').label).toBe('Opening balance deposited');
    expect(custodyMilestoneEntry('opening-stablecoin', { stablecoinSymbol: 'mUSD' })).toMatchObject({
      label: 'Stablecoin deposited',
      detail: 'Your opening mUSD arrived, paid for on your behalf.',
    });
  });

  it('carries a transaction only where there is one', () => {
    expect(custodyMilestoneEntry('activated', { txHash: 'ff'.repeat(32) }).txHash).toBe(
      'ff'.repeat(32),
    );
    expect(custodyMilestoneEntry('activated', { txHash: null }).txHash).toBeUndefined();
    expect(custodyMilestoneEntry('activated', { txHash: '  ' }).txHash).toBeUndefined();
  });

  it('says what one payment was, in the figure and ticker the row uses', () => {
    expect(
      custodySentEntry({
        amount: 5n,
        decimals: 0,
        symbol: 'mUSD',
        recipient: 'alice.night',
        txHash: 'ab'.repeat(32),
      }),
    ).toMatchObject({
      label: 'Sent 5 mUSD to alice.night',
      status: 'complete',
      txHash: 'ab'.repeat(32),
    });
  });

  it('still names a recipient when the payment went to a pasted address', () => {
    expect(custodySentEntry({ amount: 2n, decimals: 0, symbol: 'mUSD', recipient: '' }).label).toBe(
      'Sent 2 mUSD to another Passport',
    );
  });
});

describe('which transaction a row links to', () => {
  const hashes = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)];

  it('links the setup to its first transaction and the key to its last', () => {
    expect(custodyMilestoneTxHash('created', hashes, null)).toBe(hashes[0]);
    expect(custodyMilestoneTxHash('activated', hashes, null)).toBe(hashes[2]);
  });

  it('links the name to the registration this session watched', () => {
    expect(custodyMilestoneTxHash('named', hashes, 'dd'.repeat(32))).toBe('dd'.repeat(32));
    expect(custodyMilestoneTxHash('named', hashes, null)).toBeNull();
  });

  it('links a deposit to nothing, because this Passport never saw one', () => {
    expect(custodyMilestoneTxHash('opening-night', hashes, null)).toBeNull();
    expect(custodyMilestoneTxHash('opening-stablecoin', hashes, null)).toBeNull();
  });

  it('is content with a record that has no hashes at all', () => {
    /* A Passport healed from the chain, or read for the first time on a second
       device, has none. The row is still true and still worth writing. */
    expect(custodyMilestoneTxHash('created', [], null)).toBeNull();
    expect(custodyMilestoneTxHash('activated', [], null)).toBeNull();
  });
});

describe('where the written rows are remembered', () => {
  it('is keyed by the account and the network, and case cannot split it', () => {
    expect(custodyActivityMarkKey('stagenet', ACCOUNT.toUpperCase())).toBe(
      custodyActivityMarkKey('stagenet', ACCOUNT),
    );
    expect(custodyActivityMarkKey('preview', ACCOUNT)).not.toBe(
      custodyActivityMarkKey('stagenet', ACCOUNT),
    );
  });
});

describe('the stablecoin figure the trail is read from', () => {
  it('is null until the store has been asked', () => {
    expect(custodyStablecoinHeld(holdings({ shielded: [] }), false)).toBeNull();
  });

  it('is a real zero once it has', () => {
    expect(custodyStablecoinHeld(holdings({ shielded: [] }), true)).toBe(0n);
  });

  it('adds every row of that colour together', () => {
    expect(
      custodyStablecoinHeld(
        holdings({
          shielded: [
            { colourHex: MUSD_COLOUR_HEX, amount: 40n },
            { colourHex: MUSD_COLOUR_HEX.toUpperCase(), amount: 2n },
            { colourHex: OTHER_COLOUR, amount: 9n },
          ],
        }),
        true,
      ),
    ).toBe(42n);
  });
});

/* -------------------------------------------------------------------------- */
/* The steps a payment is narrated with                                       */
/* -------------------------------------------------------------------------- */

describe('the step a payment is narrated with', () => {
  it('maps the custody steps onto the four words the Send sheet has', () => {
    expect(custodySendPhase(null)).toBeNull();
    expect(custodySendPhase('wallet')).toBe('connecting');
    expect(custodySendPhase('sign')).toBe('connecting');
    expect(custodySendPhase('submit')).toBe('submitting');
    expect(custodySendPhase('confirm')).toBe('confirming');
  });

  it('never lets a setup step be narrated over a transfer', () => {
    for (const step of ['deploy', 'waves', 'activate'] as const) {
      expect(custodySendPhase(step)).toBe('submitting');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The copy rule                                                              */
/* -------------------------------------------------------------------------- */

describe('what none of these sentences may say', () => {
  const forbidden = [
    'wallet address',
    'DUST',
    'contract',
    'registry',
    'indexer',
    'resolver',
    'sponsor',
    'SDK',
    'Dynamic',
  ];

  const sentences = [
    CUSTODY_NIGHT_SEND_REFUSAL,
    CUSTODY_OLDER_NAME_REFUSAL,
    CUSTODY_OLDER_ACCOUNT_REFUSAL,
    custodySentToastTitle('unshielded'),
    custodySentEntry({ amount: 1_500_000n, decimals: 6, symbol: 'NIGHT', recipient: 'mn_addr…1234' }).label,
    ...(
      [
        'created',
        'activated',
        'named',
        'opening-night',
        'opening-stablecoin',
      ] as CustodyMilestone[]
    ).flatMap((milestone) => {
      const entry = custodyMilestoneEntry(milestone, {
        name: 'walker',
        stablecoinSymbol: 'mUSD',
      });
      return [entry.label, entry.detail];
    }),
    custodySentEntry({ amount: 5n, decimals: 0, symbol: 'mUSD', recipient: 'alice.night' }).label,
    custodySentEntry({ amount: 5n, decimals: 0, symbol: 'mUSD', recipient: 'alice.night' }).detail,
  ];

  it('says none of the words a person who chose a sign-in never asked to meet', () => {
    for (const sentence of sentences) {
      for (const word of forbidden) {
        expect(
          sentence.toLowerCase().includes(word.toLowerCase()),
          `"${sentence}" must not say "${word}"`,
        ).toBe(false);
      }
    }
  });

  it('refuses NIGHT to a name in one sentence that says what still works', () => {
    expect(CUSTODY_NIGHT_SEND_REFUSAL).toBe(
      'NIGHT can be sent to an address for now. To pay a name, choose mUSD.',
    );
    expect(CUSTODY_NIGHT_SEND_REFUSAL).not.toContain('is coming');
  });

  it('refuses a Passport on the older version, about the thing that was typed', () => {
    for (const build of ['account', 'account-v1']) {
      expect(custodyRecipientAccountRefusal(build, 'name')).toBe(
        "This name belongs to a Passport on the older version, so it can't be paid from this one. Paying between the two versions isn't supported.",
      );
      expect(custodyRecipientAccountRefusal(build, 'account')).toBe(
        "This is a Passport on the older version, so it can't be paid from this one. Paying between the two versions isn't supported.",
      );
    }
    expect(custodyRecipientAccountRefusal('account-custody', 'name')).toBeNull();
    expect(custodyRecipientAccountRefusal('midnames', 'account')).toBeNull();
    expect(CUSTODY_OLDER_NAME_REFUSAL).not.toMatch(/set their Passport up again/);
  });

  it('titles the success toast by the ledger the payment left', () => {
    expect(custodySentToastTitle('shielded')).toBe(
      'Shielded transfer accepted by the network — confirming',
    );
    expect(custodySentToastTitle('unshielded')).toBe('Transfer accepted by the network — confirming');
  });
});

describe('custodyOpeningDepositTxHash', () => {
  const rows = [
    { entryPoint: null, txHash: 'deploy' },
    { entryPoint: 'activate_initial_device_with_jubjub', txHash: 'act' },
    { entryPoint: 'deposit_unshielded', txHash: 'night-failed', status: 'FAILURE' },
    { entryPoint: 'deposit_unshielded', txHash: 'night-1', status: 'SUCCESS' },
    { entryPoint: 'deposit_shielded', txHash: 'musd-1', status: null },
    { entryPoint: 'deposit_shielded', txHash: 'musd-2' },
    { entryPoint: 'deposit_unshielded', txHash: null },
  ];

  it('links the opening NIGHT to the first successful deposit_unshielded', () => {
    expect(custodyOpeningDepositTxHash('opening-night', rows)).toBe('night-1');
  });

  it('links the opening stablecoin to the first deposit_shielded', () => {
    expect(custodyOpeningDepositTxHash('opening-stablecoin', rows)).toBe('musd-1');
  });

  it('says nothing for other milestones, an unread history, or a history without the call', () => {
    expect(custodyOpeningDepositTxHash('created', rows)).toBeNull();
    expect(custodyOpeningDepositTxHash('opening-night', null)).toBeNull();
    expect(custodyOpeningDepositTxHash('opening-stablecoin', [{ entryPoint: 'deposit_unshielded', txHash: 'x' }])).toBeNull();
  });
});
