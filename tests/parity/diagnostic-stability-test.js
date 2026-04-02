#!/usr/bin/env node

/**
 * Diagnostic Stability Test: Check if consecutive quick→full or full→quick validations
 * on the same file produce consistent results, or if LSP state is lost/corrupted between calls.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from '../../src/server.js';

const projectDir = process.argv[2] || resolve('/home/ecgtheow/Work/pos-ai-tools/pos-mcp/tests/fixtures/project');
const testFiles = [
  'app/views/partials/blog_posts/card.liquid',
  'app/views/pages/blog_posts/index.html.liquid',
  'app/views/pages/blog_posts/show.html.liquid',
].map(f => resolve(projectDir, f));

async function runDiagnosticTest() {
  console.log(`\n📊 Diagnostic Stability Test\n`);
  console.log(`Project: ${projectDir}\n`);

  const { registry, ctx } = await createServer({ projectDir });
  console.log('✅ Server started, LSP initialized\n');

  const validateCodeTool = registry.get('validate_code');
  if (!validateCodeTool) {
    console.error('❌ validate_code tool not found in registry');
    process.exit(1);
  }

  for (const filePath of testFiles) {

    console.log(`\n─ File: ${filePath.replace(projectDir, '')}`);
    console.log('─'.repeat(80));

    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (e) {
      console.log(`⚠️  File not found, skipping`);
      continue;
    }

    // Test 1: Quick → Full
    console.log('\nTest 1: quick → full');
    const quick1 = await validateCodeTool.handler({
      file_path: filePath.replace(projectDir, ''),
      content,
      mode: 'quick',
    });
    const full1 = await validateCodeTool.handler({
      file_path: filePath.replace(projectDir, ''),
      content,
      mode: 'full',
    });
    
    console.log(`  quick: ${quick1.errors.length} errors, ${quick1.warnings.length} warnings`);
    console.log(`  full:  ${full1.errors.length} errors, ${full1.warnings.length} warnings`);
    const match1 = quick1.errors.length === full1.errors.length && 
                   quick1.warnings.length === full1.warnings.length;
    console.log(`  ${match1 ? '✅' : '❌'} diagnostics match: ${match1}`);

    // Small delay
    await new Promise(r => setTimeout(r, 100));

    // Test 2: Full → Quick (same file, fresh sequence)
    console.log('\nTest 2: full → quick (fresh sequence)');
    const full2 = await validateCodeTool.handler({
      file_path: filePath.replace(projectDir, ''),
      content,
      mode: 'full',
    });
    const quick2 = await validateCodeTool.handler({
      file_path: filePath.replace(projectDir, ''),
      content,
      mode: 'quick',
    });

    console.log(`  full:  ${full2.errors.length} errors, ${full2.warnings.length} warnings`);
    console.log(`  quick: ${quick2.errors.length} errors, ${quick2.warnings.length} warnings`);
    const match2 = full2.errors.length === quick2.errors.length && 
                   full2.warnings.length === quick2.warnings.length;
    console.log(`  ${match2 ? '✅' : '❌'} diagnostics match: ${match2}`);

    // Consistency check
    const consistent = quick1.errors.length === full2.errors.length &&
                       quick1.warnings.length === full2.warnings.length;
    console.log(`\n  ${consistent ? '✅' : '❌'} consistent across sequences: ${consistent}`);
    
    if (!consistent) {
      console.log(`  ⚠️  Inconsistency detected:`);
      console.log(`    Test 1 quick: ${quick1.errors.length} errors`);
      console.log(`    Test 2 full:  ${full2.errors.length} errors`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('Test complete. If ❌ marks appear above, LSP state is unstable between calls.');
  process.exit(0);
}

runDiagnosticTest().catch(e => {
  console.error(`❌ Test failed: ${e.message}`);
  process.exit(1);
});
