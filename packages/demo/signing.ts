import crypto from 'node:crypto';

export const demoSecret = () => process.env.DEMO_SECRET || 'demo_secret';

const hmac = (secret: string, data: Buffer | string) => crypto.createHmac('sha256', secret).update(data).digest('hex');

/** GitHub-style: X-Hub-Signature-256: sha256=<hmac of the exact raw body> */
export const hubSignature = (raw: Buffer, secret = demoSecret()) => `sha256=${hmac(secret, raw)}`;

/** Stripe-style: Stripe-Signature: t=<unix>,v1=<hmac of "t.rawbody"> */
export function stripeSignature(raw: Buffer, secret = demoSecret(), t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${hmac(secret, Buffer.concat([Buffer.from(`${t}.`), raw]))}`;
}

const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const verifyHub = (raw: Buffer, header: string | undefined, secret = demoSecret()) =>
  !!header && safeEqual(header, hubSignature(raw, secret));

export function verifyStripe(raw: Buffer, header: string | undefined, secret = demoSecret()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  if (!parts.t || !parts.v1) return false;
  return safeEqual(parts.v1, hmac(secret, Buffer.concat([Buffer.from(`${parts.t}.`), raw])));
}
