import type { Request, Response } from 'express';
import { contacts } from '../app/db.js';

export async function handleHubspotPhone(req: Request, res: Response): Promise<void> {
  const event = req.body;
  const phone = event.properties.phone_number;

  if (!Number.isInteger(phone)) {
    throw new TypeError(`phone_number must be an integer, received ${typeof phone}`);
  }

  await contacts.upsert({ hubspotId: event.objectId, phone });
  res.json({ ok: true, contactId: event.objectId });
}
