/**
 * Adapted from Nutlope/llamacoder lib/preview/html.ts, commit
 * 4e2ee75147a6834d3d5d035dec023b311abb4836. MIT, © 2024 Hassan El Mghari.
 * Full licence in THIRD-PARTY-NOTICES.md. Storage is deliberately ephemeral.
 */
export const previewSupport = `
function memoryStorageShim() {
  const values = new Map();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key) { values.delete(String(key)); },
    setItem(key, value) { values.set(String(key), String(value)); },
  };
}
try {
  Object.defineProperty(window, 'localStorage', { value: memoryStorageShim(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorageShim(), configurable: true });
} catch (_) {}
function reportError(message) {
  parent.postMessage({channel:'passport-builder:app',method:'error',message:String(message).slice(0,2000)}, __HOST_ORIGIN__);
}
window.addEventListener('error', event => reportError(event.message));
window.addEventListener('unhandledrejection', event => reportError(event.reason?.message || event.reason));
`;
