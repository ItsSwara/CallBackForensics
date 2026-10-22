import type { Request, Response } from 'express';
import { analytics } from '../app/db.js';

export async function handleOrderItems(req: Request, res: Response): Promise<void> {
  const order = req.body;
  const headlinePrice = order.items[0].price;

  await analytics.track('order_created', {
    orderId: order.id,
    headlinePrice,
    lineCount: order.items.length,
  });
  res.json({ ok: true, orderId: order.id });
}
