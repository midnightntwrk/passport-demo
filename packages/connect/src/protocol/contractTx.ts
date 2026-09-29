import { PassportProtocolError } from './errors.js';
import { createPassportTxResponse, readPassportTxResponse, PASSPORT_TX_PROTOCOL, type PassportTxResponse } from './tx.js';
import { isBoundedString, isRecord, malformed, notPassport, ok, readProtocolVersion, type PassportParseResult } from './version.js';

/** Restricted stagenet calls. The wallet independently inspects the transaction. */
export const PASSPORT_CONTRACT_TX_PROTOCOL = 'org.midnight.passport.contract-tx/v1' as const;
export const MAX_CONTRACT_TRANSACTION_HEX = 2 * 1024 * 1024;

export interface PassportContractTransactionIntent {
  networkId: 'stagenet';
  /** ledger-v9 Transaction<SignatureEnabled, Proof, PreBinding>, serialised as hex. */
  transaction: string;
  contractAddress: string;
  entryPoint: string;
  purpose: string;
}

export interface PassportContractTxRequest {
  protocol: typeof PASSPORT_CONTRACT_TX_PROTOCOL;
  type: 'passport.contract-tx.request';
  version: number;
  requestId: string;
  nonce: string;
  intent: PassportContractTransactionIntent;
}

export type PassportContractTxResponse = Omit<PassportTxResponse, 'protocol' | 'type'> & {
  protocol: typeof PASSPORT_CONTRACT_TX_PROTOCOL;
  type: 'passport.contract-tx.response';
};

export function readPassportContractTxRequest(value: unknown): PassportParseResult<PassportContractTxRequest> {
  if (!isRecord(value) || value.protocol !== PASSPORT_CONTRACT_TX_PROTOCOL || value.type !== 'passport.contract-tx.request') return notPassport();
  const version = readProtocolVersion(value);
  if (version.kind !== 'ok') return version;
  if (!isBoundedString(value.requestId, 256) || !isBoundedString(value.nonce, 256)) return malformed('Missing request id or nonce.');
  if (!isRecord(value.intent)) return malformed('Missing contract transaction intent.');
  const i = value.intent;
  if (i.networkId !== 'stagenet') return malformed('Contract transactions are supported on stagenet only.');
  if (typeof i.transaction !== 'string' || !i.transaction.length || i.transaction.length > MAX_CONTRACT_TRANSACTION_HEX || !/^(?:[0-9a-fA-F]{2})+$/.test(i.transaction)) return malformed('Transaction must be non-empty hexadecimal, at most 1 MiB.');
  if (typeof i.contractAddress !== 'string' || !/^[0-9a-f]{64}$/.test(i.contractAddress)) return malformed('Contract address must be 64 lower-case hexadecimal characters.');
  if (typeof i.entryPoint !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(i.entryPoint)) return malformed('Invalid circuit name.');
  if (!isBoundedString(i.purpose, 280)) return malformed('Purpose must be 1 to 280 characters.');
  return ok({ protocol: PASSPORT_CONTRACT_TX_PROTOCOL, type: 'passport.contract-tx.request', version: version.version, requestId: value.requestId, nonce: value.nonce, intent: { networkId: 'stagenet', transaction: i.transaction, contractAddress: i.contractAddress, entryPoint: i.entryPoint, purpose: i.purpose } });
}

export function createPassportContractTxRequest(input: PassportContractTransactionIntent & { requestId: string; nonce: string }): PassportContractTxRequest {
  const { requestId, nonce, ...intent } = input;
  const parsed = readPassportContractTxRequest({ protocol: PASSPORT_CONTRACT_TX_PROTOCOL, type: 'passport.contract-tx.request', version: 1, requestId, nonce, intent });
  if (parsed.kind !== 'ok') throw new PassportProtocolError('invalid-request', 'Invalid contract transaction request.');
  return parsed.value;
}

export function createPassportContractTxResponse(pair: { requestId: string; nonce: string }, body: Omit<PassportTxResponse, 'protocol' | 'type' | 'version' | 'requestId' | 'nonce'>): PassportContractTxResponse {
  return { ...createPassportTxResponse(pair, body), protocol: PASSPORT_CONTRACT_TX_PROTOCOL, type: 'passport.contract-tx.response' };
}

export function readPassportContractTxResponse(value: unknown): PassportParseResult<PassportContractTxResponse> {
  if (!isRecord(value) || value.protocol !== PASSPORT_CONTRACT_TX_PROTOCOL || value.type !== 'passport.contract-tx.response') return notPassport();
  const parsed = readPassportTxResponse({ ...value, protocol: PASSPORT_TX_PROTOCOL, type: 'passport.tx.response' });
  if (parsed.kind !== 'ok') return parsed;
  return ok({ ...parsed.value, protocol: PASSPORT_CONTRACT_TX_PROTOCOL, type: 'passport.contract-tx.response' });
}
