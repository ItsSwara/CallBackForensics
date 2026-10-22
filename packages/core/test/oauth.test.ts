import { describe, expect, it } from 'vitest';
import { analyzeRules, oauthFindings } from '../src/index.js';

describe('oauthFindings', () => {
  it('reports error=, error_description=, a redirect_uri mismatch, and the missing code/state', () => {
    const out = oauthFindings('/callback/oauth', 'error=access_denied&error_description=redirect_uri+mismatch');
    expect(out.join('\n')).toContain('error=access_denied');
    expect(out.join('\n')).toContain('error_description="redirect_uri mismatch"');
    expect(out.join('\n')).toContain('does not exactly match one registered');
    expect(out.join('\n')).toContain('No code parameter');
    expect(out.join('\n')).toContain('No state parameter');
  });

  it('flags only a missing state when code is present', () => {
    const out = oauthFindings('/callback/oauth', 'code=abc');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('No state parameter');
  });

  it('flags only a missing code when state is present', () => {
    const out = oauthFindings('/auth/return', 'state=xyz');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('No code parameter');
  });

  it('stays quiet on a healthy callback and on non-OAuth paths', () => {
    expect(oauthFindings('/callback/oauth', 'code=abc&state=xyz')).toEqual([]);
    expect(oauthFindings('/webhooks/stripe', '')).toEqual([]);
  });

  it('only runs for GET requests inside analyzeRules', () => {
    const base = { path: '/callback/oauth', query: 'error=access_denied', status: 500, stderr: '', rootDir: '.' };
    expect(analyzeRules({ ...base, method: 'GET' }).ruleBased.join('\n')).toContain('error=access_denied');
    expect(analyzeRules({ ...base, method: 'POST', payload: '{}' }).ruleBased.join('\n')).not.toContain('error=access_denied');
  });
});
