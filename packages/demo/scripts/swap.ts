import fs from 'node:fs';
import path from 'node:path';
import { demoDir, SCENARIOS } from '../scenarios.js';

// usage: tsx swap.ts fix|reset <scenario|all>
const [mode, target] = process.argv.slice(2);
if ((mode !== 'fix' && mode !== 'reset') || !target) {
  console.error('Usage: npm run demo:fix -- <scenario|all>   |   npm run demo:reset -- <scenario|all>');
  console.error('Scenarios: ' + SCENARIOS.map((s) => s.name).join(', '));
  process.exit(1);
}
const names = target === 'all' ? SCENARIOS.map((s) => s.name) : [target];
for (const name of names) {
  if (!SCENARIOS.some((s) => s.name === name)) {
    console.error(`Unknown scenario "${name}"`);
    process.exit(1);
  }
  const from = path.join(demoDir, mode === 'fix' ? 'fixes' : 'broken', `${name}.ts`);
  const to = path.join(demoDir, 'handlers', `${name}.ts`);
  fs.copyFileSync(from, to);
  console.log(`${mode === 'fix' ? 'Applied fix to' : 'Restored broken version of'} handlers/${name}.ts`);
}
