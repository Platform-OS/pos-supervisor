#!/usr/bin/env node

/**
 * Sequential Validation Test: Validate multiple files in sequence,
 * first quick→full on each file, then full→quick to check for inconsistencies.
 * This mimics the actual workflow and may trigger LSP state corruption.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from '../../src/server.js';

const projectDir = process.argv[2] || resolve('/home/ecgtheow/Work/pos-ai-tools/pos-mcp/tests/fixtures/broken-project');

function collectLiquidFiles(dir, relPath = '') {
  const files = [];
  try {
    const entries = readdirSync(join(dir, relPath), { withFileTypes: true });
    for (const entry of entries) {
      const currentPath = relPath ? `${relPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...collectLiquidFiles(dir, currentPath));
      } else if (entry.name.endsWith('.liquid')) {
        files.push(currentPath);
      }
    }
  } catch (e) {
    // Ignore errors silently
  }
  return files;
}

async function runSequentialTest() {
  console.log(`\n📊 Sequential Validation Test (Multi-File)\n`);
  console.log(`Project: ${projectDir}\n`);

  const { registry, ctx } = await createServer({ projectDir });
  console.log('✅ Server started, LSP initialized\n');

  // Wait a bit for indexes to load
  await new Promise(r => setTimeout(r, 1000));

  const testFiles = collectLiquidFiles(projectDir);
  if (testFiles.length === 0) {
    console.log('⚠️  No .liquid files found in project');
    process.exit(0);
  }

  console.log(`Found ${testFiles.length} .liquid file(s)\n`);

  const validateCodeTool = registry.get('validate_code');
  if (!validateCodeTool) {
    console.error('❌ validate_code tool not found in registry');
    process.exit(1);
  }

  const results = new Map(); // file → { quick1, full1, full2, quick2 }

  // ─────────────────────────────────────────────────────────────────────
  // PASS 1: quick → full on each file
  // ─────────────────────────────────────────────────────────────────────
  console.log('PASS 1: Validating each file with quick → full');
  console.log('─'.repeat(80));

  for (const file of testFiles) {
    const absPath = join(projectDir, file);
    let content;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      console.log(`⚠️  ${file} — cannot read, skipping`);
      continue;
    }

    const quick1 = await validateCodeTool.handler({ file_path: file, content, mode: 'quick' });
    const full1 = await validateCodeTool.handler({ file_path: file, content, mode: 'full' });

    results.set(file, { quick1, full1 });

    const match = quick1.errors.length === full1.errors.length && quick1.warnings.length === full1.warnings.length;
    const symbol = match ? '✅' : '❌';
    console.log(`${symbol} ${file.padEnd(60)} quick=${quick1.errors.length}e/${quick1.warnings.length}w  full=${full1.errors.length}e/${full1.warnings.length}w`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // PASS 2: full → quick on each file (reverse order)
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(80));
  console.log('\nPASS 2: Validating each file with full → quick (reverse order)');
  console.log('─'.repeat(80));

  const reversedFiles = [...testFiles].reverse();
  for (const file of reversedFiles) {
    const absPath = join(projectDir, file);
    let content;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }

    const full2 = await validateCodeTool.handler({ file_path: file, content, mode: 'full' });
    const quick2 = await validateCodeTool.handler({ file_path: file, content, mode: 'quick' });

    const prev = results.get(file);
    if (prev) {
      prev.full2 = full2;
      prev.quick2 = quick2;
    } else {
      results.set(file, { full2, quick2 });
    }

    const match = full2.errors.length === quick2.errors.length && full2.warnings.length === quick2.warnings.length;
    const symbol = match ? '✅' : '❌';
    console.log(`${symbol} ${file.padEnd(60)} full=${full2.errors.length}e/${full2.warnings.length}w  quick=${quick2.errors.length}e/${quick2.warnings.length}w`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // ANALYSIS: Check for inconsistencies
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(80));
  console.log('ANALYSIS: Comparing Pass 1 vs Pass 2');
  console.log('='.repeat(80) + '\n');

  const inconsistencies = [];
  for (const [file, data] of results) {
    if (!data.quick1 || !data.full1 || !data.full2 || !data.quick2) continue;

    const q1e = data.quick1.errors.length, q1w = data.quick1.warnings.length;
    const f1e = data.full1.errors.length, f1w = data.full1.warnings.length;
    const f2e = data.full2.errors.length, f2w = data.full2.warnings.length;
    const q2e = data.quick2.errors.length, q2w = data.quick2.warnings.length;

    // Check if results are consistent across passes
    const pass1Match = (q1e === f1e && q1w === f1w);
    const pass2Match = (f2e === q2e && f2w === q2w);
    const consistentAcrossPasses = (q1e === f2e && q1w === f2w && f1e === q2e && f1w === q2w);

    if (!pass1Match || !pass2Match || !consistentAcrossPasses) {
      inconsistencies.push({
        file,
        pass1: { q1: [q1e, q1w], f1: [f1e, f1w], match: pass1Match },
        pass2: { f2: [f2e, f2w], q2: [q2e, q2w], match: pass2Match },
        consistent: consistentAcrossPasses,
      });
    }
  }

  if (inconsistencies.length === 0) {
    console.log('✅ All validations consistent across both passes!');
  } else {
    console.log(`❌ Found ${inconsistencies.length} inconsistent file(s):\n`);
    for (const inc of inconsistencies) {
      console.log(`  ${inc.file}`);
      console.log(`    Pass 1: quick=${inc.pass1.q1.join('e/')}w  full=${inc.pass1.f1.join('e/')}w  [${inc.pass1.match ? '✅' : '❌'}]`);
      console.log(`    Pass 2: full=${inc.pass2.f2.join('e/')}w  quick=${inc.pass2.q2.join('e/')}w  [${inc.pass2.match ? '✅' : '❌'}]`);
      console.log(`    Across: ${inc.consistent ? '✅ consistent' : '❌ INCONSISTENT'}\n`);
    }
  }

  process.exit(inconsistencies.length > 0 ? 1 : 0);
}

runSequentialTest().catch(e => {
  console.error(`❌ Test failed: ${e.message}`);
  process.exit(1);
});
