import type { Request, Response } from 'express';
import { contacts } from '../app/db.js';

export async function handleHubspotPhone(req: Request, res: Response): Promise<void> {
  const event = req.body;
  const raw = event.properties.phone_number;
  const phone = typeof raw === 'string' ? raw.replace(/[^\d+]/g, '') : raw;

  await contacts.upsert({ hubspotId: event.objectId, phone });
  res.json({ ok: true, contactId: event.objectId });
}
