/**
 * OAuth redirect rules. These are the only OAuth-specific checks; they read the callback's query string.
 *
 *   1. `error=<code>`            -> the provider reported an error (known codes get a plain-English meaning)
 *   2. `error_description=<txt>` -> echoed as the provider's own explanation; a redirect_uri mismatch is called out
 *   3. no `code` parameter       -> the authorization code never arrived
 *   4. no `state` parameter      -> the callback cannot be tied back to the login that started it
 *
 * They only run when the request looks like an OAuth callback: the query has one of those parameters, or the
 * path contains oauth / callback / redirect / auth.
 */
export const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'the user or the provider refused the authorization request',
  invalid_request: 'the authorization request was malformed or missing a required parameter',
  unauthorized_client: 'this client is not allowed to use this authorization flow',
  unsupported_response_type: 'the provider does not support the requested response_type',
  invalid_scope: 'the requested scope is invalid or unknown',
  server_error: 'the provider hit an internal error',
  temporarily_unavailable: 'the provider is temporarily overloaded or down',
};

const OAUTH_PATH = /oauth|callback|redirect|auth/i;
const OAUTH_PARAMS = ['error', 'error_description', 'code', 'state'];

export function looksLikeOauthCallback(path: string, query: string): boolean {
  const params = new URLSearchParams(query);
  return OAUTH_PARAMS.some((p) => params.has(p)) || OAUTH_PATH.test(path);
}

export function oauthFindings(path: string, query: string): string[] {
  if (!looksLikeOauthCallback(path, query)) return [];
  const params = new URLSearchParams(query);
  const out: string[] = [];

  const error = params.get('error');
  if (error) {
    const meaning = OAUTH_ERRORS[error];
    out.push(`error=${error}: the OAuth provider reported an error${meaning ? `, ${meaning}` : ''}.`);
  }
  const description = params.get('error_description');
  if (description) {
    out.push(`error_description="${description}": this is the provider's own explanation.`);
    if (/redirect[_ ]?uri/i.test(description) && /mismatch|not match|invalid/i.test(description)) {
      out.push('The redirect_uri sent to the provider does not exactly match one registered for the app (check scheme, host, port, path and trailing slash).');
    }
  }
  if (!params.get('code')) {
    out.push(
      error
        ? 'No code parameter: the authorization code was not issued (expected after an error), so there is nothing to exchange for a token.'
        : 'No code parameter: the authorization code is missing, so the token exchange cannot run.',
    );
  }
  if (!params.get('state')) {
    out.push('No state parameter: this callback cannot be matched to the login request that started it, so the CSRF check will fail.');
  }
  return out;
}
