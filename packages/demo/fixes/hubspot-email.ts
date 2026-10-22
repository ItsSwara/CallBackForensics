import type { Request, Response } from 'express';
import { mailingList } from '../app/db.js';

export async function handleHubspotEmail(req: Request, res: Response): Promise<void> {
  const contact = req.body;
  if (typeof contact.email !== 'string' || contact.email === '') {
    res.json({ ok: true, skipped: 'contact has no email address' });
    return;
  }
  const email = contact.email.toLowerCase();

  await mailingList.subscribe({ email, name: contact.firstname });
  res.json({ ok: true, subscribed: email });
}
