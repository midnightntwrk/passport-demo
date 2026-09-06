/**
 * The MetaMask-derived recovery key — sign-to-derive.
 *
 * The third rung of the guard ladder: a key that is NOT on this device and
 * can let its holder back in after the device is gone. No key material is
 * asked of the user and none is stored anywhere: the secret is DERIVED, on
 * demand, from a deterministic signature.
 *
 * WHY A SIGNATURE IS A SEED
 * -------------------------
 * `personal_sign` over secp256k1 uses RFC 6979 deterministic nonces, so the
 * same wallet signing the same message produces the same signature, forever,
 * on any device MetaMask runs on. Hash that signature and it is a stable
 * 32-byte root only the wallet's holder can reproduce — the same shape as
 * the passkey's PRF output, and it is fed through the very same derivation
 * (`deriveAccountDeviceSecret`) so the two kinds of device differ in where
 * their root comes from and in nothing else.
 *
 * THE MESSAGE IS FROZEN. Recovery depends on re-deriving the same secret
 * years later on a different machine, so the text below is versioned and
 * must never be edited — a new derivation is a NEW message with a new
 * version, enrolled as an additional device, never a rewrite of this one.
 * It deliberately names no account and no network: one wallet is one
 * recovery identity, reproducible before the app knows which Passport it is
 * about to rescue — which is the whole point.
 *
 * WHAT ENROLMENT PUTS ON CHAIN is only the device COMMITMENT (the contract's
 * own `derive_device_commitment` over the derived secret). The signature,
 * the secret, and the wallet stay with the user.
 */

export const RECOVERY_MESSAGE_V1 =
  'Midnight Passport recovery key (v1).\n' +
  'Signing this derives the key that can restore access to your Passport.\n' +
  'It never leaves this device. Only sign this inside Midnight Passport.';

/** The one slice of the injected provider this module relies on. */
export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** The injected wallet, or null — presence is a fact of the browser, not ours. */
export function getEthereumProvider(): EthereumProvider | null {
  const injected = (globalThis as { ethereum?: unknown }).ethereum;
  if (!injected || typeof injected !== 'object') return null;
  if (typeof (injected as { request?: unknown }).request !== 'function') return null;
  return injected as EthereumProvider;
}

/** UTF-8, 0x-hex — the encoding `personal_sign` expects its message in. */
function utf8ToHex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hex = '0x';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error('The wallet answered with something that is not a signature.');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Asks the injected wallet for the deterministic signature the derivation is
 * built on. Two prompts at most (connect, then sign), both the wallet's own.
 */
export async function requestRecoverySignature(
  provider: EthereumProvider,
): Promise<{ ethAddress: string; signature: string }> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as
    | string[]
    | undefined;
  const ethAddress = accounts?.[0];
  if (!ethAddress) throw new Error('The wallet connected but offered no account.');
  const signature = (await provider.request({
    method: 'personal_sign',
    params: [utf8ToHex(RECOVERY_MESSAGE_V1), ethAddress],
  })) as string;
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new Error('The wallet did not sign.');
  }
  return { ethAddress, signature };
}

/**
 * Signature → the recovery DEVICE SECRET, through the same derivation the
 * passkey root takes. The caller zeroes the result the moment the commitment
 * is derived from it — enrolment never holds the secret longer than that.
 */
export async function recoverySecretFromSignature(signature: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', hexToBytes(signature) as BufferSource);
  const root = new Uint8Array(digest);
  try {
    /* Imported on demand: this module is otherwise light enough for the app
       to import statically (provider detection, the record store), and the
       custody module behind the derivation stays out of the first bundle
       exactly as it does everywhere else. */
    const { deriveAccountDeviceSecret } = await import('./accountCustody.js');
    return await deriveAccountDeviceSecret(root);
  } finally {
    root.fill(0);
  }
}

/* -------------------------------------------------------------------------- */
/* The per-credential record — display state; the LEDGER is the authority     */
/* -------------------------------------------------------------------------- */

export interface RecoveryKeyRecord {
  /** The wallet account that signed — the user-facing name of this key. */
  ethAddress: string;
  /** The enrolled device commitment, as `formatFieldHex` spells it. */
  commitmentHex: string;
  /** The `add_device` transaction. */
  txId: string;
  txIdResolved: boolean;
  network: string;
  contractAddress: string;
  addedAt: string;
}

/* Under the mn-passport: prefix so the forget-this-device sweep (App.tsx)
   forgets it by default, like every other Passport record. */
const STORAGE_PREFIX = 'mn-passport:recovery-key:';

export function loadRecoveryKeyRecord(credentialId: string): RecoveryKeyRecord | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${credentialId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecoveryKeyRecord;
    return typeof parsed?.ethAddress === 'string' && typeof parsed?.txId === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function saveRecoveryKeyRecord(credentialId: string, record: RecoveryKeyRecord): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${credentialId}`, JSON.stringify(record));
  } catch {
    // Best-effort: the ledger still holds the device; only the label is lost.
  }
}
