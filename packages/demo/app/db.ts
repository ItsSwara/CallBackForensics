// Tiny in-memory stand-ins for the data stores a real service would use.

export interface ContactRow {
  hubspotId: number;
  phone: number | string;
}

export const contacts = {
  rows: [] as ContactRow[],
  async upsert(row: ContactRow) {
    const i = this.rows.findIndex((r) => r.hubspotId === row.hubspotId);
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
    return row;
  },
};

export const reviewQueue = {
  jobs: [] as { repo: string; number: number; author: string }[],
  async enqueue(job: { repo: string; number: number; author: string }) {
    this.jobs.push(job);
  },
};

export const receipts = {
  sent: [] as { to: string; amount: number }[],
  async send(r: { to: string; amount: number }) {
    this.sent.push(r);
  },
};

export const mailingList = {
  subscribers: new Set<string>(),
  async subscribe(s: { email: string; name?: string }) {
    this.subscribers.add(s.email);
  },
};

export const analytics = {
  events: [] as { name: string; props: Record<string, unknown> }[],
  async track(name: string, props: Record<string, unknown>) {
    this.events.push({ name, props });
  },
};

export const loginSessions = new Map<string, { verifier: string }>([['st_9f2c1', { verifier: 'v-demo-verifier' }]]);

export const oauthClient = {
  async exchange(input: { code: string; verifier: string }) {
    return { accessToken: `tok_${input.code.slice(0, 6)}` };
  },
};
