import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoSecret, hubSignature, stripeSignature } from './signing.js';

export const demoDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(demoDir, '..', '..');

export type Kind = 'good' | 'bad';

export interface ScenarioDef {
  name: string;
  /** Route the demo app serves (and the path appended to the public relay URL). */
  path: string;
  sig: 'hub' | 'stripe';
  headers: (kind: Kind) => Record<string, string>;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    name: 'hubspot-phone',
    path: '/webhooks/hubspot-phone',
    sig: 'hub',
    headers: () => ({ 'user-agent': 'HubSpot Connect 2.0 (http://dev.hubspot.com/)' }),
  },
  {
    name: 'github-pr',
    path: '/webhooks/github',
    sig: 'hub',
    headers: (kind) => ({
      'user-agent': 'GitHub-Hookshot/3f1c2ab',
      'x-github-event': kind === 'good' ? 'pull_request' : 'issues',
      'x-github-delivery': crypto.randomUUID(),
    }),
  },
  {
    name: 'stripe-customer',
    path: '/webhooks/stripe',
    sig: 'stripe',
    headers: () => ({ 'user-agent': 'Stripe/1.0 (+https://stripe.com/docs/webhooks)' }),
  },
  {
    name: 'hubspot-email',
    path: '/webhooks/hubspot-email',
    sig: 'hub',
    headers: () => ({ 'user-agent': 'HubSpot Connect 2.0 (http://dev.hubspot.com/)' }),
  },
  {
    name: 'order-items',
    path: '/webhooks/orders',
    sig: 'hub',
    headers: () => ({ 'user-agent': 'shop-events/2.4', 'x-shop-topic': 'orders/create' }),
  },
];

export function getScenario(name: string): ScenarioDef {
  const s = SCENARIOS.find((x) => x.name === name);
  if (!s) throw new Error(`Unknown scenario "${name}". Choose one of: ${SCENARIOS.map((x) => x.name).join(', ')}`);
  return s;
}

/** Raw file bytes: payloads are never parsed and re-serialised, so signatures stay valid. */
export const loadPayload = (name: string, kind: Kind): Buffer =>
  fs.readFileSync(path.join(demoDir, 'scenarios', name, `${kind}.json`));

export interface Truth {
  description: string;
  /** Every group must be matched; within a group, any alternative counts. Case-insensitive. */
  keywords: string[][];
}

export const loadTruth = (name: string): Truth =>
  JSON.parse(fs.readFileSync(path.join(demoDir, 'scenarios', name, 'truth.json'), 'utf8'));

export function buildRequest(name: string, kind: Kind, secret = demoSecret()) {
  const def = getScenario(name);
  const body = loadPayload(name, kind);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...def.headers(kind),
    ...(def.sig === 'stripe' ? { 'stripe-signature': stripeSignature(body, secret) } : { 'x-hub-signature-256': hubSignature(body, secret) }),
  };
  return { path: def.path, headers, body };
}
