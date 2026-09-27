/**
 * The light address reader, held to the wallet SDK's codec.
 *
 * `midnightAddress.ts` replaces the SDK's `address-format` on the first render
 * path only; the send itself still decodes with the SDK. So the property that
 * matters is not "it decodes bech32m" but "it reaches the SDK's verdict", and
 * that is what every case here asserts: the SDK parses and decodes the same
 * string, and the two answers are compared whole — parsed or refused, the
 * type, the network, the payload, and which codecs accept it on which network.
 *
 * The SDK is imported directly, which pulls in the ledger WebAssembly. That is
 * fine in a test and is exactly what the module under test exists to avoid in
 * the entry chunk.
 */

import * as sdk from '@midnight-ntwrk/wallet-sdk/address-format'
import { describe, expect, it } from 'vitest'

import { MidnightBech32m, ShieldedAddress, UnshieldedAddress, mainnet } from './midnightAddress.js'

const NETWORKS = ['mainnet', 'preview', 'preprod', 'stagenet', 'undeployed', 'testnet-2'] as const

/* ------------------------------------------------------------------ */
/* A test-only encoder, for strings the SDK will not write             */
/* ------------------------------------------------------------------ */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let bit = 0; bit < 5; bit += 1) if ((top >>> bit) & 1) checksum ^= GENERATORS[bit]
  }
  return checksum >>> 0
}

/**
 * Any prefix and any 5-bit words, with a correct checksum — bech32m by
 * default, classic bech32 when asked. It is how the malformed-but-checksummed
 * cases below are made: bad padding, bad segments, a prefix that is not `mn`.
 */
function encodeWords(prefix: string, words: number[], constant = 0x2bc830a3): string {
  const expanded = [
    ...[...prefix].map((c) => c.charCodeAt(0) >> 5),
    0,
    ...[...prefix].map((c) => c.charCodeAt(0) & 31),
  ]
  const mod = polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ constant
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31)
  return `${prefix}1${[...words, ...checksum].map((w) => CHARSET[w]).join('')}`
}

function toWords(bytes: Uint8Array): number[] {
  const words: number[] = []
  let carry = 0
  let bits = 0
  for (const byte of bytes) {
    carry = ((carry << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) {
      bits -= 5
      words.push((carry >> bits) & 31)
    }
  }
  if (bits > 0) words.push((carry << (5 - bits)) & 31)
  return words
}

const encodeBytes = (prefix: string, bytes: Uint8Array) => encodeWords(prefix, toWords(bytes))

/* ------------------------------------------------------------------ */
/* The two verdicts                                                    */
/* ------------------------------------------------------------------ */

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

type Verdict =
  | { parsed: false }
  | { parsed: true; type: string; network: string; data: string; accepts: string[] }

function lightVerdict(text: string): Verdict {
  let parsed: MidnightBech32m
  try {
    parsed = MidnightBech32m.parse(text)
  } catch {
    return { parsed: false }
  }
  const accepts: string[] = []
  for (const network of NETWORKS) {
    for (const [name, codec] of [
      ['addr', UnshieldedAddress],
      ['shield-addr', ShieldedAddress],
    ] as const) {
      try {
        parsed.decode(codec as typeof UnshieldedAddress, network)
        accepts.push(`${name}@${network}`)
      } catch {
        // Refused on this network, as the SDK must refuse it too.
      }
    }
  }
  return {
    parsed: true,
    type: parsed.type,
    network: parsed.network === mainnet ? 'mainnet' : parsed.network,
    data: hex(parsed.data),
    accepts,
  }
}

function sdkVerdict(text: string): Verdict {
  let parsed: sdk.MidnightBech32m
  try {
    parsed = sdk.MidnightBech32m.parse(text)
  } catch {
    return { parsed: false }
  }
  const accepts: string[] = []
  for (const network of NETWORKS) {
    for (const [name, codec] of [
      ['addr', sdk.UnshieldedAddress],
      ['shield-addr', sdk.ShieldedAddress],
    ] as const) {
      try {
        parsed.decode(codec, network)
        accepts.push(`${name}@${network}`)
      } catch {
        // Refused on this network.
      }
    }
  }
  /* The SDK leaves an absent type as `undefined`, whatever its declaration
     says; the reader says ''. Both mean "no codec will take this", which
     `accepts` then shows. */
  const type: string | undefined = parsed.type
  return {
    parsed: true,
    type: type ?? '',
    network: parsed.network === sdk.mainnet ? 'mainnet' : parsed.network,
    data: hex(parsed.data),
    accepts,
  }
}

/* ------------------------------------------------------------------ */
/* The corpus                                                          */
/* ------------------------------------------------------------------ */

const key = (fill: number, length = 32) => Buffer.alloc(length, fill)
const sdkNetwork = (network: (typeof NETWORKS)[number]) => (network === 'mainnet' ? 'mainnet' : network)

/** Every address type the SDK writes, on every network, as the SDK writes it. */
const SDK_ADDRESSES = NETWORKS.flatMap((network) => [
  sdk.MidnightBech32m.encode(sdkNetwork(network), new sdk.UnshieldedAddress(key(0x0f))).asString(),
  sdk.MidnightBech32m.encode(
    sdkNetwork(network),
    new sdk.ShieldedAddress(new sdk.ShieldedCoinPublicKey(key(0x11)), new sdk.ShieldedEncryptionPublicKey(key(0x22))),
  ).asString(),
  sdk.MidnightBech32m.encode(sdkNetwork(network), new sdk.DustAddress(123456789n)).asString(),
  sdk.ShieldedCoinPublicKey.codec.encode(sdkNetwork(network), new sdk.ShieldedCoinPublicKey(key(0x33))).asString(),
])

/** The two the mocked walks paste, verbatim from `e2e/send-assets.spec.ts`. */
const WALK_UNSHIELDED = 'mn_addr_stagenet127xnp9uuxwhh7a8an77mxv02ypt6u09xkk63c9zvdkjsrj4mj68qg7c5ad'
const WALK_SHIELDED =
  'mn_shield-addr_stagenet1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygjyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs74ltnl'

const flipLast = (text: string) =>
  `${text.slice(0, -1)}${text.endsWith('q') ? 'p' : 'q'}`

/** Each way a string can fail to be an address, and each way it can nearly be one. */
const MALFORMED: Record<string, string> = {
  empty: '',
  'too short': 'mn1qqqq',
  'no separator': 'mn_addr_stagenetqqqqqqqqqqqq',
  'separator first': '1qqqqqqqqqqqq',
  'data shorter than a checksum': 'mn_addr1qqqqq',
  'mixed case': `M${WALK_UNSHIELDED.slice(1)}`,
  'upper case throughout': WALK_UNSHIELDED.toUpperCase(),
  'a letter outside the alphabet': `${WALK_UNSHIELDED.slice(0, 30)}b${WALK_UNSHIELDED.slice(31)}`,
  'a wrong checksum': flipLast(WALK_UNSHIELDED),
  'a classic bech32 checksum': encodeWords('mn_addr_stagenet', toWords(key(0x0f)), 1),
  'a prefix with a space': encodeWords('mn addr', toWords(key(0x0f))),
  'a prefix above ASCII': encodeWords('mn_addré', toWords(key(0x0f))),
  'excess padding': encodeWords('mn_addr', [0, 0, 0]),
  'non-zero padding': encodeWords('mn_addr', [0, 1]),
  'not mn': encodeBytes('bc_addr', key(0x0f)),
  'mn and nothing else': encodeBytes('mn', key(0x0f)),
  'an empty type': encodeBytes('mn_', key(0x0f)),
  'a type with a bad character': encodeBytes('mn_ad!dr', key(0x0f)),
  'an empty network': encodeBytes('mn_addr_', key(0x0f)),
  'a network with a bad character': encodeBytes('mn_addr_stage.net', key(0x0f)),
  'a network with a zero': encodeBytes('mn_addr_net0', key(0x0f)),
  'a fourth segment': encodeBytes('mn_addr_stagenet_extra', key(0x0f)),
  'mainnet spelt out': encodeBytes('mn_addr_mainnet', key(0x0f)),
  'an unshielded address one byte long': encodeBytes('mn_addr_stagenet', key(0x0f, 33)),
  'an unshielded address one byte short': encodeBytes('mn_addr_stagenet', key(0x0f, 31)),
  'a shielded address with no encryption key': encodeBytes('mn_shield-addr_stagenet', key(0x11)),
  'a shielded address with a short coin key': encodeBytes('mn_shield-addr_stagenet', key(0x11, 16)),
  'an unknown type': encodeBytes('mn_somethingelse_stagenet', key(0x0f)),
}

/* ------------------------------------------------------------------ */

describe('the test encoder', () => {
  it('writes what the SDK writes, so the hand-made cases are the real shape', () => {
    expect(encodeBytes('mn_addr_stagenet', key(0x0f))).toBe(
      sdk.MidnightBech32m.encode('stagenet', new sdk.UnshieldedAddress(key(0x0f))).asString(),
    )
    expect(encodeBytes('mn_shield-addr_stagenet', Buffer.concat([key(0x11), key(0x22)]))).toBe(WALK_SHIELDED)
  })
})

describe('MidnightBech32m.parse and decode, against the SDK', () => {
  it.each(SDK_ADDRESSES.map((address) => [address]))('reaches the SDK verdict on %s', (address) => {
    const verdict = lightVerdict(address)
    expect(verdict).toEqual(sdkVerdict(address))
    expect(verdict.parsed).toBe(true)
  })

  it.each(Object.entries(MALFORMED))('reaches the SDK verdict on %s', (_, text) => {
    expect(lightVerdict(text)).toEqual(sdkVerdict(text))
  })

  it.each([
    ['the walk unshielded address', WALK_UNSHIELDED],
    ['the walk shielded address', WALK_SHIELDED],
  ])('reaches the SDK verdict on %s', (_, text) => {
    expect(lightVerdict(text)).toEqual(sdkVerdict(text))
  })
})

describe('what the codecs hand back', () => {
  it('reads an unshielded address to its 32 bytes', () => {
    const bytes = MidnightBech32m.parse(WALK_UNSHIELDED).decode(UnshieldedAddress, 'stagenet')
    const reference = sdk.MidnightBech32m.parse(WALK_UNSHIELDED).decode(sdk.UnshieldedAddress, 'stagenet')
    expect(hex(bytes)).toBe(reference.hexString)
  })

  it('reads a shielded address to its two keys', () => {
    const keys = MidnightBech32m.parse(WALK_SHIELDED).decode(ShieldedAddress, 'stagenet')
    expect(hex(keys.coinPublicKey)).toBe('11'.repeat(32))
    expect(hex(keys.encryptionPublicKey)).toBe('22'.repeat(32))
  })

  it('takes a shielded address past bech32’s 90-character ceiling — the v11 regression', () => {
    expect(WALK_SHIELDED.length).toBeGreaterThan(90)
    expect(MidnightBech32m.parse(WALK_SHIELDED).network).toBe('stagenet')
  })

  it('reads mainnet as the network with no segment', () => {
    const address = SDK_ADDRESSES[0]
    expect(address.startsWith('mn_addr1')).toBe(true)
    expect(MidnightBech32m.parse(address).network).toBe(mainnet)
  })
})

describe('the refusals say which rule was broken', () => {
  it.each([
    [MALFORMED['too short'], /invalid string length/],
    [MALFORMED['mixed case'], /mixed-case/],
    [MALFORMED['no separator'], /separator/],
    [MALFORMED['data shorter than a checksum'], /data length/],
    [MALFORMED['a letter outside the alphabet'], /letter "b"/],
    [MALFORMED['a wrong checksum'], /Invalid checksum/],
    [MALFORMED['a prefix with a space'], /Invalid prefix/],
    [MALFORMED['excess padding'], /Excess padding/],
    [MALFORMED['non-zero padding'], /Non-zero padding/],
    [MALFORMED['not mn'], /Expected prefix mn/],
    [MALFORMED['an empty type'], /Segment type/],
    [MALFORMED['an empty network'], /Segment network/],
  ])('%s', (text, message) => {
    expect(() => MidnightBech32m.parse(text)).toThrow(message)
  })

  it('names the type and the network a decode expected', () => {
    const parsed = MidnightBech32m.parse(WALK_UNSHIELDED)
    expect(() => parsed.decode(ShieldedAddress, 'stagenet')).toThrow(
      'Expected type shield-addr, got addr',
    )
    expect(() => parsed.decode(UnshieldedAddress, 'mainnet')).toThrow(
      'Expected mainnet address, got stagenet one',
    )
    expect(() => MidnightBech32m.parse(SDK_ADDRESSES[0]).decode(UnshieldedAddress, 'preview')).toThrow(
      'Expected preview address, got mainnet one',
    )
  })

  it('names the length a codec wanted', () => {
    expect(() =>
      MidnightBech32m.parse(MALFORMED['an unshielded address one byte long']).decode(UnshieldedAddress, 'stagenet'),
    ).toThrow('32 bytes')
    expect(() =>
      MidnightBech32m.parse(MALFORMED['a shielded address with a short coin key']).decode(ShieldedAddress, 'stagenet'),
    ).toThrow('32 bytes')
  })
})
