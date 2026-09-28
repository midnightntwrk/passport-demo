/** A deployed receiver, not a configured origin, is required for functional app writes. */
export function acceptsPassportCapabilities(value: unknown): boolean {
  const v = value as any;
  return v?.protocol === 'org.midnight.passport.capabilities/v1' && Array.isArray(v.networks) && v.networks.includes('stagenet') &&
    v.profile?.popup === true && v.profile?.signedRedirect === true && v.profile?.custody === true &&
    v.contracts?.protocol === 'org.midnight.passport.contract-tx/v1' && v.contracts?.approval === true && v.contracts?.publicState === true;
}
