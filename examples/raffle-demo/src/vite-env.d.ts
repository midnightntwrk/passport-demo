/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSPORT_ORIGIN?: string;
  readonly VITE_TELEGRAM_URL?: string;
  /**
   * The unshielded address (`mn_addr…`) the raffle operator controls, on the
   * network Passport runs on (stagenet for the deployed demo).
   * Set it to turn on real on-chain entry; leave it unset and the raffle stays
   * in profile-only mode and says so.
   */
  readonly VITE_RAFFLE_COLLECTION_ADDRESS?: string;
  /** Entry price in atomic NIGHT units. Defaults to `100000` — 0.1 NIGHT. */
  readonly VITE_RAFFLE_ENTRY_AMOUNT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
