import type { Request, Response } from 'express';
import { reviewQueue } from '../app/db.js';

export async function handleGithubPr(req: Request, res: Response): Promise<void> {
  const payload = req.body;
  const author = payload.pull_request.user.login;

  await reviewQueue.enqueue({
    repo: payload.repository.full_name,
    number: payload.number,
    author,
  });
  res.json({ ok: true, queued: payload.number });
}
