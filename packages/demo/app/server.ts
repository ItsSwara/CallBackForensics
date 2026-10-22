import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { handleGithubPr } from '../handlers/github-pr.js';
import { handleHubspotEmail } from '../handlers/hubspot-email.js';
import { handleHubspotPhone } from '../handlers/hubspot-phone.js';
import { handleOrderItems } from '../handlers/order-items.js';
import { handleStripeCustomer } from '../handlers/stripe-customer.js';
import { verifyHub, verifyStripe } from '../signing.js';

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

const raw = (req: Request) => (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);

const requireHub: RequestHandler = (req, res, next) => {
  if (!verifyHub(raw(req), req.header('x-hub-signature-256'))) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }
  next();
};

const requireStripe: RequestHandler = (req, res, next) => {
  if (!verifyStripe(raw(req), req.header('stripe-signature'))) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }
  next();
};

const route =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'demo app' });
});
app.post('/webhooks/hubspot-phone', requireHub, route(handleHubspotPhone));
app.post('/webhooks/github', requireHub, route(handleGithubPr));
app.post('/webhooks/stripe', requireStripe, route(handleStripeCustomer));
app.post('/webhooks/hubspot-email', requireHub, route(handleHubspotEmail));
app.post('/webhooks/orders', requireHub, route(handleOrderItems));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`demo app listening on :${port}`);
});
