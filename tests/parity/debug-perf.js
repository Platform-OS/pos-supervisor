#!/usr/bin/env node
/**
 * Debug: See what's happening during diagnostics
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from '../../src/server.js';

const projectDir = resolve('/home/ecgtheow/Work/pos-ai-tools/pos-mcp/tests/fixtures/broken-project');
const filePath = 'app/views/pages/products/index.html.liquid';

async function debug() {
  console.log(`\n🔍 Debug: Diagnostic Performance\n`);

  // Server startup
  const startupStart = Date.now();
  const { registry, ctx } = await createServer({ projectDir });
  const createServerTime = Date.now() - startupStart;
  console.log(`Server created: ${createServerTime}ms`);

  // Wait for warm-up
  const warmupStart = Date.now();
  await ctx.lspReady;
  const warmupTime = Date.now() - warmupStart;
  console.log(`LSP warm-up: ${warmupTime}ms`);

  const validateCodeTool = registry.get('validate_code');
  const content = readFileSync(resolve(projectDir, filePath), 'utf8');

  console.log(`\nTesting quick mode:\n`);

  // Add logging to ctx
  const originalLog = ctx.log;
  let logBuffer = '';
  ctx.log = (msg) => {
    logBuffer += msg + '\n';
    originalLog?.(msg);
  };

  // Single quick validation
  const start = Date.now();
  const result = await validateCodeTool.handler({ file_path: filePath, content, mode: 'quick' });
  const elapsed = Date.now() - start;

  console.log(`\nValidation time: ${elapsed}ms`);
  console.log(`Errors: ${result.errors?.length ?? 0}`);
  console.log(`Warnings: ${result.warnings?.length ?? 0}`);

  if (logBuffer) {
    console.log(`\nLogs during validation:`);
    console.log(logBuffer);
  }

  process.exit(0);
}

debug().catch(e => {
  console.error(`❌ Debug failed: ${e.message}\n${e.stack}`);
  process.exit(1);
});
