import { resolve } from 'node:path';
import type { BuilderConfig } from '../shared/types.js';

export const dataDir = resolve(process.env.BUILDER_DATA_DIR || './data');
export const port = Number(process.env.PORT || 5189);
export const adminToken = process.env.BUILDER_ACCESS_TOKEN || '';
function configuredOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Builder and Passport URLs must be HTTP(S) origins without paths or credentials.');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production origins must use HTTPS.');
  return url.origin;
}
export const passportOrigin = configuredOrigin(process.env.PASSPORT_ORIGIN || 'https://midnightpassport.com');
export const passportAuthOrigin = configuredOrigin(process.env.PASSPORT_AUTH_ORIGIN || passportOrigin);
export const devMode = process.env.BUILDER_DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';
export const allowedOrigins = [...new Set([process.env.BUILDER_PUBLIC_URL || '', ...(process.env.BUILDER_ALLOWED_ORIGINS || '').split(',')]
  .map(origin => origin.trim()).filter(Boolean).map(configuredOrigin))];
export const defaultModel = process.env.OPENROUTER_MODEL || 'openai/gpt-6-luna-pro:nitro';
export const models = [{ id: defaultModel, name: defaultModel === 'openai/gpt-6-luna-pro:nitro' ? 'GPT 6 Luna Pro · Nitro' : defaultModel }];
export const config: BuilderConfig = {
  network: 'stagenet', passportOrigin, passportAuthOrigin, devMode, models, defaultModel, adminRequired: false,
  openrouterConfigured: !!process.env.OPENROUTER_API_KEY,
  compilerConfigured: false,
  deploymentConfigured: !!process.env.BUILDER_PROOF_SERVER_URL && !!process.env.BUILDER_SPONSOR_URL,
  services: [],
};

export function assertConfiguration() {
  if (process.env.BUILDER_NETWORK && process.env.BUILDER_NETWORK !== 'stagenet') {
    throw new Error('Passport Builder supports stage-net only.');
  }
  if (process.env.BUILDER_DEV_MODE && !['true', 'false'].includes(process.env.BUILDER_DEV_MODE)) throw new Error('BUILDER_DEV_MODE must be true or false.');
  if (process.env.NODE_ENV === 'production') {
    if (passportAuthOrigin !== passportOrigin) throw new Error('Production sign-in and transaction approvals must use the same Passport origin.');
    if (process.env.BUILDER_DEV_MODE === 'true') throw new Error('The Passport sign-in bypass is only available in local development.');
    if (adminToken && adminToken.length < 32) throw new Error('BUILDER_ACCESS_TOKEN must have at least 32 characters when configured in production.');
    if (!allowedOrigins.length) throw new Error('Production requires a trusted BUILDER_PUBLIC_URL or BUILDER_ALLOWED_ORIGINS.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
}
