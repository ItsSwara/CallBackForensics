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
  sig: 'hub' | 'stripe' | 'none';
  /** "query" scenarios are GET redirects: good.json / bad.json hold {"query": "..."} instead of a body. */
  mode?: 'json' | 'query';
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
  {
    name: 'oauth-redirect',
    path: '/callback/oauth',
    sig: 'none',
    mode: 'query',
    headers: () => ({ 'user-agent': 'Mozilla/5.0 (browser redirect)', accept: 'text/html' }),
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

export interface BuiltRequest {
  method: 'GET' | 'POST';
  /** Pathname only; the query string is separate. */
  path: string;
  query: string;
  headers: Record<string, string>;
  body: Buffer;
}

export function buildRequest(name: string, kind: Kind, secret = demoSecret()): BuiltRequest {
  const def = getScenario(name);
  const file = loadPayload(name, kind);
  if (def.mode === 'query') {
    const { query } = JSON.parse(file.toString('utf8')) as { query: string };
    return { method: 'GET', path: def.path, query, headers: def.headers(kind), body: Buffer.alloc(0) };
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...def.headers(kind),
    ...(def.sig === 'stripe' ? { 'stripe-signature': stripeSignature(file, secret) } : { 'x-hub-signature-256': hubSignature(file, secret) }),
  };
  return { method: 'POST', path: def.path, query: '', headers, body: file };
}

/** fetch() arguments for a built request, against `base` (no trailing slash). */
export function toFetch(base: string, req: BuiltRequest): [string, RequestInit] {
  const url = base + req.path + (req.query ? `?${req.query}` : '');
  return [
    url,
    {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' ? undefined : new Uint8Array(req.body),
      redirect: 'manual',
    },
  ];
}
