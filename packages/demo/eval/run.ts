import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { diagnose, isAiOk, type Diagnosis } from '@cbf/core';
import { StderrBuffer } from '../../cli/src/stderr.js';
import { buildRequest, demoDir, loadTruth, repoRoot, SCENARIOS, toFetch, type Truth } from '../scenarios.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const matches = (truth: Truth, text: string) => {
  const t = text.toLowerCase();
  return truth.keywords.every((group) => group.some((alt) => t.includes(alt.toLowerCase())));
};

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

async function post(port: number, scenario: string, kind: 'good' | 'bad') {
  const req = buildRequest(scenario, kind);
  const res = await fetch(...toFetch(`http://127.0.0.1:${port}`, req));
  await res.text();
  return { status: res.status, body: req.body, method: req.method, path: req.path, query: req.query };
}

/**
 * For each scenario: send the good payload, then the bad payload, straight to the demo app (no relay),
 * capture its stderr, run diagnose(), and score the output against truth.json. No cache is used, so
 * timings are real. Keywords are fixed in truth.json ahead of time and are never tuned to a model.
 */
async function main() {
  const { values } = parseArgs({
    options: { 'ai-url': { type: 'string' }, label: { type: 'string' }, out: { type: 'string' } },
  });
  const aiUrl = values['ai-url'] || process.env.CBF_AI_URL || 'http://localhost:8080';
  const label = values.label || 'run';
  const outFile = path.resolve(values.out || path.join(repoRoot, 'eval', 'results.md'));

  const port = await freePort();
  const stderr = new StderrBuffer(2000);
  const app = spawn(process.execPath, ['--import', 'tsx', path.join(demoDir, 'app', 'server.ts')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  app.stderr.on('data', (c: Buffer) => stderr.push(c));
  const stop = () => {
    if (app.pid && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
    else app.kill();
  };
  process.on('exit', stop);

  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      break;
    } catch {
      await sleep(150);
    }
  }

  interface Row {
    scenario: string;
    rule: string;
    ai: string;
    seconds: string;
    answer: string;
    rulePass: boolean;
    aiPass: boolean;
    valid: boolean;
  }
  const rows: Row[] = [];
  let model = 'unknown';

  for (const { name } of SCENARIOS) {
    const truth = loadTruth(name);
    const good = await post(port, name, 'good');
    const startedAt = Date.now();
    const bad = await post(port, name, 'bad');
    await sleep(400);
    if (bad.status < 500) {
      rows.push({ scenario: name, rule: 'n/a', ai: 'n/a', seconds: '-', answer: `bad payload returned HTTP ${bad.status}; handler already fixed? run npm run demo:reset`, rulePass: false, aiPass: false, valid: false });
      continue;
    }
    const d: Diagnosis = await diagnose(
      {
        method: bad.method,
        path: bad.path,
        query: bad.query,
        status: bad.status,
        payload: bad.body,
        prevOkPayload: good.status < 300 ? good.body : undefined,
        stderr: stderr.window(startedAt - 50, Date.now()),
        rootDir: repoRoot,
      },
      { aiUrl, timeoutMs: 180_000 },
    );
    const ruleText = [...d.ruleBased, d.errorMessage ?? ''].join('\n');
    const rulePass = matches(truth, ruleText);
    let ai = 'ERROR';
    let aiPass = false;
    let seconds = '-';
    let answer = '';
    if (d.ai && isAiOk(d.ai)) {
      aiPass = matches(truth, d.ai.text);
      ai = aiPass ? 'PASS' : 'FAIL';
      seconds = (d.ai.ms / 1000).toFixed(1);
      answer = d.ai.text;
      model = d.ai.model;
    } else if (d.ai) {
      answer = `(no answer) ${d.ai.error.message}`;
    }
    rows.push({ scenario: name, rule: rulePass ? 'PASS' : 'FAIL', ai, seconds, answer, rulePass, aiPass, valid: true });
  }
  stop();

  const header = `| scenario | rule-based | AI pass/fail | seconds |\n|---|---|---|---|`;
  const table = rows.map((r) => `| ${r.scenario} | ${r.rule} | ${r.ai} | ${r.seconds} |`).join('\n');
  const valid = rows.filter((r) => r.valid);
  const summary = `Rule-based: ${valid.filter((r) => r.rulePass).length}/${valid.length} · AI: ${valid.filter((r) => r.aiPass).length}/${valid.length}`;
  console.log(`\n${header}\n${table}\n\n${summary}`);

  const details = rows
    .map((r) => `<details><summary>${r.scenario}</summary>\n\n\`\`\`\n${r.answer}\n\`\`\`\n\n</details>`)
    .join('\n');
  const block = `\n## ${label} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · model: ${model} · server: ${aiUrl}\n\n${header}\n${table}\n\n${summary}\n\nPass means the output mentions every keyword group in each scenario's truth.json (fixed in advance). Rule-based scoring uses the diff findings plus the parsed error line. Failures are reported as they happened.\n\n${details}\n`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (!fs.existsSync(outFile)) fs.writeFileSync(outFile, '# Eval results\n\nAppended by `npm run eval`. One block per run.\n');
  fs.appendFileSync(outFile, block);
  console.log(`\nAppended to ${path.relative(process.cwd(), outFile)}`);
  process.exit(0);
}

main().catch((e: Error) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
