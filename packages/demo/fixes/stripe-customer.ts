import type { Request, Response } from 'express';
import { receipts } from '../app/db.js';

export async function handleStripeCustomer(req: Request, res: Response): Promise<void> {
  const event = req.body;
  const session = event.data.object;
  const email = session.customer?.email ?? session.customer_details?.email;

  if (!email) {
    res.json({ received: true, id: event.id, receipt: 'skipped: no customer email' });
    return;
  }
  await receipts.send({ to: email, amount: session.amount_total });
  res.json({ received: true, id: event.id });
}
