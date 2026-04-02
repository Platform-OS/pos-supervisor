#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from '../../src/server.js';

const projectDir = resolve('/home/ecgtheow/Work/pos-ai-tools/pos-mcp/tests/fixtures/broken-project');
const filePath = 'app/views/partials/products/shopify_contaminated.liquid';

async function runDiagnosticDebug() {
  const { registry, ctx } = await createServer({ projectDir });
  const validateCodeTool = registry.get('validate_code');

  // Wait for indexes
  await new Promise(r => setTimeout(r, 1000));

  const content = readFileSync(resolve(projectDir, filePath), 'utf8');

  console.log(`\nFile: ${filePath}\n`);
  console.log('─'.repeat(80));

  const quick = await validateCodeTool.handler({ file_path: filePath, content, mode: 'quick' });
  console.log('\nQUICK MODE:');
  console.log(`Errors (${quick.errors.length}):`);
  quick.errors.forEach((e, i) => {
    console.log(`  ${i+1}. [${e.check}] Line ${e.line}: ${e.message.slice(0, 60)}`);
  });
  console.log(`Warnings (${quick.warnings.length}):`);
  quick.warnings.forEach((w, i) => {
    console.log(`  ${i+1}. [${w.check}] Line ${w.line}: ${w.message.slice(0, 60)}`);
  });

  console.log('\n' + '─'.repeat(80));

  const full = await validateCodeTool.handler({ file_path: filePath, content, mode: 'full' });
  console.log('\nFULL MODE:');
  console.log(`Errors (${full.errors.length}):`);
  full.errors.forEach((e, i) => {
    console.log(`  ${i+1}. [${e.check}] Line ${e.line}: ${e.message.slice(0, 60)}`);
  });
  console.log(`Warnings (${full.warnings.length}):`);
  full.warnings.forEach((w, i) => {
    console.log(`  ${i+1}. [${w.check}] Line ${w.line}: ${w.message.slice(0, 60)}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('\nDIFFERENCE ANALYSIS:');
  console.log(`Quick: ${quick.errors.length}e / ${quick.warnings.length}w`);
  console.log(`Full:  ${full.errors.length}e / ${full.warnings.length}w`);

  // Compare error checks
  const quickChecks = quick.errors.map(e => e.check).sort();
  const fullChecks = full.errors.map(e => e.check).sort();
  const quickWarnChecks = quick.warnings.map(w => w.check).sort();
  const fullWarnChecks = full.warnings.map(w => w.check).sort();

  console.log(`\nError checks (quick):  ${quickChecks.join(', ')}`);
  console.log(`Error checks (full):   ${fullChecks.join(', ')}`);
  console.log(`\nWarning checks (quick): ${quickWarnChecks.join(', ')}`);
  console.log(`Warning checks (full):  ${fullWarnChecks.join(', ')}`);

  process.exit(0);
}

runDiagnosticDebug().catch(e => {
  console.error(`❌ Test failed: ${e.message}`);
  process.exit(1);
});
