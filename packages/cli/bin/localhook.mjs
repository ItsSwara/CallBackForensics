#!/usr/bin/env node
// Thin launcher so `localhook` works without a build step: it registers tsx and loads the TypeScript entry.
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
