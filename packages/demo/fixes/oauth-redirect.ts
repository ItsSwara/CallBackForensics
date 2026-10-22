import type { Request, Response } from 'express';
import { loginSessions, oauthClient } from '../app/db.js';

export async function handleOauthRedirect(req: Request, res: Response): Promise<void> {
  const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
  if (error || !code || !state) {
    res.status(200).type('html').send(`<p>Sign-in did not complete: ${error_description ?? error ?? 'missing code or state'}.</p>`);
    return;
  }
  const pending = loginSessions.get(state);
  if (!pending) {
    res.status(200).type('html').send('<p>Sign-in session expired. Please try again.</p>');
    return;
  }

  const tokens = await oauthClient.exchange({ code: code.trim(), verifier: pending.verifier });
  res.cookie('session', tokens.accessToken, { httpOnly: true });
  res.redirect(302, '/dashboard');
}
