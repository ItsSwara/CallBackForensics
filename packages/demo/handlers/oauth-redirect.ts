import type { Request, Response } from 'express';
import { loginSessions, oauthClient } from '../app/db.js';

export async function handleOauthRedirect(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query as Record<string, string>;
  const pending = loginSessions.get(state);

  const tokens = await oauthClient.exchange({ code: code.trim(), verifier: pending!.verifier });
  res.cookie('session', tokens.accessToken, { httpOnly: true });
  res.redirect(302, '/dashboard');
}
