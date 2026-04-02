#!/usr/bin/env node
/**
 * Debug: Trace where time is spent
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from '../../src/server.js';

const projectDir = resolve('/home/ecgtheow/Work/pos-ai-tools/pos-mcp/tests/fixtures/broken-project');
const filePath = 'app/views/pages/products/index.html.liquid';

async function debug() {
  console.log(`\n⏱️ Timing Breakdown\n`);

  const { registry, ctx } = await createServer({ projectDir });
  await ctx.lspReady;

  const content = readFileSync(resolve(projectDir, filePath), 'utf8');

  // Manually do what validate_code does, but with timing
  console.log('Calling validate_code handler...\n');

  const startTotal = Date.now();

  // Inline the handler to time each step
  const validateCodeTool = registry.get('validate_code');

  // Call with timing
  const steps = [];

  // Measure validateCodeTool.handler
  const start = Date.now();
  const result = await validateCodeTool.handler({ file_path: filePath, content, mode: 'quick' });
  const elapsed = Date.now() - start;

  console.log(`Total validation time: ${elapsed}ms`);
  console.log(`Errors: ${result.errors?.length ?? 0}`);

  // Let's also check if LSP is actually initialized
  console.log(`\nLSP initialized: ${ctx.lsp?.initialized}`);
  console.log(`LSP warmed up: true (at this point)`);

  process.exit(0);
}

debug().catch(e => {
  console.error(`❌ Debug failed: ${e.message}`);
  process.exit(1);
});
