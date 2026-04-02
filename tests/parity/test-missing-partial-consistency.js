#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from '../../src/server.js';

const projectDir = resolve('/home/ecgtheow/Work/pos-ai-tools/pos-mcp/tests/fixtures/broken-project');
const filePath = 'app/views/pages/products/index.html.liquid';

async function testMissingPartialConsistency() {
  const { registry, ctx } = await createServer({ projectDir });
  const validateCodeTool = registry.get('validate_code');

  // Wait for indexes and LSP to be truly ready
  await new Promise(r => setTimeout(r, 2000));

  const content = readFileSync(resolve(projectDir, filePath), 'utf8');

  console.log(`\nFile: ${filePath}\n`);
  console.log(`File content:\n${'-'.repeat(80)}`);
  console.log(content);
  console.log(`${'-'.repeat(80)}\n`);

  console.log('Running 10 consecutive validations (alternating quick/full)...\n');

  const results = [];
  for (let i = 1; i <= 10; i++) {
    const mode = i % 2 === 1 ? 'quick' : 'full';
    const result = await validateCodeTool.handler({ file_path: filePath, content, mode });
    
    // Look for any diagnostic with "MissingPartial" in check
    const hasMissingPartial = [
      ...result.errors,
      ...result.warnings,
      ...result.infos
    ].some(d => d.check && d.check.includes('MissingPartial'));

    const errorCount = (result.errors && Array.isArray(result.errors)) ? result.errors.length : 0;
    const warningCount = (result.warnings && Array.isArray(result.warnings)) ? result.warnings.length : 0;

    results.push({
      call: i,
      mode,
      errors: errorCount,
      warnings: warningCount,
      hasMissingPartial,
      missingPartialDiags: [
        ...(result.errors || []),
        ...(result.warnings || []),
        ...(result.infos || [])
      ].filter(d => d.check && d.check.includes('MissingPartial'))
    });

    const symbol = hasMissingPartial ? '✅' : '❌';
    console.log(`${symbol} Call ${i} (${mode}): ${errorCount}e / ${warningCount}w - MissingPartial: ${hasMissingPartial ? 'YES' : 'NO'}`);
    
    // Add a small delay between calls to let LSP settle
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n' + '='.repeat(80));
  console.log('ANALYSIS:');
  console.log('='.repeat(80) + '\n');

  const missingPartialFound = results.filter(r => r.hasMissingPartial);
  const missingPartialMissed = results.filter(r => !r.hasMissingPartial);

  console.log(`Total calls: ${results.length}`);
  console.log(`Calls with MissingPartial: ${missingPartialFound.length}`);
  console.log(`Calls missing MissingPartial: ${missingPartialMissed.length}`);

  if (missingPartialMissed.length > 0) {
    console.log(`\n⚠️  INCONSISTENCY DETECTED!\n`);
    console.log(`Calls that missed MissingPartial:`);
    missingPartialMissed.forEach(r => {
      console.log(`  - Call ${r.call} (${r.mode}): ${r.errors.length}e / ${r.warnings.length}w`);
    });
  }

  if (missingPartialFound.length > 0) {
    console.log(`\nCalls that found MissingPartial:`);
    missingPartialFound.forEach(r => {
      console.log(`  - Call ${r.call} (${r.mode}): ${r.errors}e / ${r.warnings}w`);
      r.missingPartialDiags.forEach(d => {
        console.log(`    → [${d.check}] Line ${d.line}: ${d.message.slice(0, 80)}`);
      });
    });
  }

  process.exit(0);
}

testMissingPartialConsistency().catch(e => {
  console.error(`❌ Test failed: ${e.message}`);
  process.exit(1);
});
