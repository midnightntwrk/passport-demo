// Browser shim for isomorphic-ws: its browser build only has a default
// export, but @midnight-ntwrk/midnight-js-indexer-public-data-provider does
// a named `import { WebSocket }`. The alias in vite.config resolves here.
//
// It used to live in experiments/account-custody-prototype, a directory the
// public repository does not carry — which is why its build failed there on
// 2026/09/15. The demo owns its own six lines now.

export const WebSocket = globalThis.WebSocket;
export default globalThis.WebSocket;
