import { createRelay } from './server.js';

const port = Number(process.env.PORT) || 8080;
const trust = process.env.TRUST_PROXY;
const relay = createRelay({
  dbPath: process.env.DB_PATH || './relay.db',
  trustProxy: trust === undefined ? 1 : /^\d+$/.test(trust) ? Number(trust) : trust === 'true' ? true : trust === 'false' ? false : trust,
});

relay.start(port).then((p) => {
  console.log(`relay listening on :${p} (db: ${process.env.DB_PATH || './relay.db'})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void relay.stop().then(() => process.exit(0));
  });
}
