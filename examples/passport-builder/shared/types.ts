import type { GenerationProgress } from './generation.js';

export type ProjectStatus = 'draft' | 'generating' | 'compiling' | 'ready' | 'deploying' | 'submitted' | 'deployed' | 'failed';
export type ProjectFiles = Record<string, string>;
export interface AssetRequest { name: string; prompt: string; alt: string; aspectRatio: '1:1' | '16:9' | '9:16' }
export interface AppAsset extends AssetRequest { status?: 'ready' | 'unavailable'; hash?: string; error?: string }
export interface Build {
  id: string;
  revision: number;
  sourceHash: string;
  compilerVersion: string;
  circuits: string[];
  createdAt: string;
}
export interface Deployment {
  id: string;
  buildId: string;
  status: 'deploying' | 'submitted' | 'deployed' | 'failed' | 'unknown';
  contractAddress?: string;
  txId?: string;
  appUrl?: string;
  error?: string;
  createdAt: string;
}
export interface Project {
  id: string;
  ownerSubject?: string;
  name: string;
  description: string;
  model: string;
  status: ProjectStatus;
  revision: number;
  files: ProjectFiles;
  assets?: AppAsset[];
  generation?: GenerationProgress;
  messages: { role: 'user' | 'assistant'; content: string; createdAt: string }[];
  logs: { id: string; stage: string; level: 'info' | 'error'; message: string; createdAt: string }[];
  build?: Build;
  deployments: Deployment[];
  error?: string;
  previewUrl?: string;
  createdAt: string;
  updatedAt: string;
}
export interface BuilderConfig {
  network: 'stagenet';
  passportOrigin: string;
  passportAuthOrigin: string;
  devMode: boolean;
  models: { id: string; name: string }[];
  defaultModel: string;
  adminRequired: boolean;
  openrouterConfigured: boolean;
  compilerConfigured: boolean;
  deploymentConfigured: boolean;
  services: { name: string; state: 'ready' | 'configured' | 'unconfigured' | 'unavailable'; message: string }[];
}

export interface AuthSession {
  authenticated: boolean;
  profile?: { displayName?: string };
  expiresAt?: string;
  devMode: boolean;
}
