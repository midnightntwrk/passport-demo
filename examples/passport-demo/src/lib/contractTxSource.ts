/** Only channels owned by Passport may request approval; never trust an origin alone.
 * Kept independent of the ledger so listening for requests cannot delay first paint. */
export function contractRequestSourceMatches(event: Pick<MessageEvent, 'origin' | 'source'>, peer: { source: Window | null; origin: string | null }): boolean {
  if (!peer.source || event.source !== peer.source || event.origin === 'null') return false;
  if (peer.origin !== null && peer.origin !== event.origin) return false;
  try { return ['https:', 'http:'].includes(new URL(event.origin).protocol); } catch { return false; }
}
