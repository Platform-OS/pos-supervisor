#!/usr/bin/env node
/**
 * Benchmark: Diagnostic speed with LSP warm-up
 * 
 * Measures:
 * 1. Server startup + warm-up time
 * 2. Per-file diagnostic time
 * 3. Compares quick vs full mode
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createServer } from '../../src/server.js';

const projectDir = process.argv[2] || resolve('/home/ecgtheow/Work/pos-ai-tools/pos-mcp/tests/fixtures/broken-project');

if (!existsSync(projectDir)) {
  console.error(`❌ Project directory not found: ${projectDir}`);
  process.exit(1);
}

async function benchmark() {
  console.log(`\n📊 Diagnostic Performance Benchmark`);
  console.log(`   Project: ${relative(process.cwd(), projectDir)}`);
  console.log(`   Mode: LSP with mandatory warm-up\n`);

  // Measure startup (just server creation)
  const startupStart = Date.now();
  const { registry, ctx } = await createServer({ projectDir });
  const createServerTime = Date.now() - startupStart;

  // Wait for LSP to be fully ready (including warm-up)
  const warmupStart = Date.now();
  await ctx.lspReady;
  const warmupTime = Date.now() - warmupStart;

  const validateCodeTool = registry.get('validate_code');

  console.log(`✓ Server created in ${createServerTime}ms`);
  console.log(`✓ LSP warm-up completed in ${warmupTime}ms`);
  console.log(`✓ Total startup time: ${createServerTime + warmupTime}ms\n`);

  // Sample files to test
  const sampleFiles = [
    'app/views/pages/index.html.liquid',
    'app/views/pages/products/index.html.liquid',
    'app/views/partials/products/caller.liquid',
    'app/lib/commands/create_message.liquid',
  ].filter(f => {
    try {
      readFileSync(resolve(projectDir, f));
      return true;
    } catch {
      return false;
    }
  });

  if (sampleFiles.length === 0) {
    console.error('❌ No sample files found');
    process.exit(1);
  }

  console.log(`Testing ${sampleFiles.length} sample files...\n`);

  const results = {
    quick: [],
    full: [],
  };

  for (const filePath of sampleFiles) {
    const content = readFileSync(resolve(projectDir, filePath), 'utf8');

    // Test quick mode
    const quickStart = Date.now();
    const quickResult = await validateCodeTool.handler({ file_path: filePath, content, mode: 'quick' });
    const quickTime = Date.now() - quickStart;
    results.quick.push(quickTime);

    // Test full mode
    const fullStart = Date.now();
    const fullResult = await validateCodeTool.handler({ file_path: filePath, content, mode: 'full' });
    const fullTime = Date.now() - fullStart;
    results.full.push(fullTime);

    const errors = quickResult.errors?.length ?? 0;
    const warnings = quickResult.warnings?.length ?? 0;
    const shortPath = relative(projectDir, filePath);

    console.log(`${shortPath}`);
    console.log(`  Quick: ${quickTime}ms (${errors}e/${warnings}w)`);
    console.log(`  Full:  ${fullTime}ms (${fullResult.errors?.length ?? 0}e/${fullResult.warnings?.length ?? 0}w)`);
    console.log();
  }

  // Summary
  const avgQuick = Math.round(results.quick.reduce((a, b) => a + b, 0) / results.quick.length);
  const avgFull = Math.round(results.full.reduce((a, b) => a + b, 0) / results.full.length);
  const maxQuick = Math.max(...results.quick);
  const maxFull = Math.max(...results.full);
  const totalStartupTime = createServerTime + warmupTime;

  console.log(`${'='.repeat(60)}`);
  console.log(`Summary:`);
  console.log(`  Server creation:     ${createServerTime}ms`);
  console.log(`  LSP warm-up:         ${warmupTime}ms`);
  console.log(`  ---`);
  console.log(`  Quick mode:  ${avgQuick}ms avg, ${maxQuick}ms max (${results.quick.length} files)`);
  console.log(`  Full mode:   ${avgFull}ms avg, ${maxFull}ms max (${results.full.length} files)`);
  console.log(`  Speedup:     ${(avgFull / avgQuick).toFixed(1)}x (full vs quick)`);

  const totalValidationTime = results.quick.reduce((a, b) => a + b, 0) + results.full.reduce((a, b) => a + b, 0);
  const totalTime = totalStartupTime + totalValidationTime;
  console.log(`  ---`);
  console.log(`  Total validation:    ${totalValidationTime}ms (${results.quick.length * 2} files)`);
  console.log(`  Total time:          ${totalTime}ms (startup + validation)`);
  console.log(`${'='.repeat(60)}\n`);

  process.exit(0);
}

benchmark().catch(e => {
  console.error(`❌ Benchmark failed: ${e.message}`);
  process.exit(1);
});
