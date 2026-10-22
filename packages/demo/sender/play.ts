import { parseArgs } from 'node:util';
import { getScenario } from '../scenarios.js';
import { printResult, resolveBase, sendScenario } from './send.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { url: { type: 'string' } } });
  const scenario = positionals[0] || 'hubspot-phone';
  const def = getScenario(scenario);
  const base = await resolveBase(values.url);
  console.log(`Playing "${scenario}" against ${base}${def.path}: good, good, bad (1s apart)\n`);
  for (const kind of ['good', 'good', 'bad'] as const) {
    printResult(scenario, kind, await sendScenario(base, scenario, kind));
    if (kind !== 'bad') await sleep(1000);
  }
}

main().catch((e: Error) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
