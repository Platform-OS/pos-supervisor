#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from '../../src/server.js';

const projectDir = resolve('/home/ecgtheow/Work/pos-ai-tools/pos-mcp/tests/fixtures/broken-project');
const filePath = 'app/views/pages/products/index.html.liquid';

async function testMissingPartialWithContentChanges() {
  const { registry, ctx } = await createServer({ projectDir });
  const validateCodeTool = registry.get('validate_code');

  // Wait for LSP to warm up
  await new Promise(r => setTimeout(r, 2000));

  let content = readFileSync(resolve(projectDir, filePath), 'utf8');

  console.log(`\nFile: ${filePath}\n`);
  console.log(`Original content:\n${'-'.repeat(80)}`);
  console.log(content);
  console.log(`${'-'.repeat(80)}\n`);

  console.log('Test 1: Validate original content 3 times');
  console.log('─'.repeat(80));
  
  for (let i = 1; i <= 3; i++) {
    const result = await validateCodeTool.handler({ file_path: filePath, content, mode: 'quick' });
    const errorCount = result.errors ? result.errors.length : 0;
    const missingPartial = result.errors.find(e => e.check === 'MissingPartial');
    const symbol = missingPartial ? '✅' : '❌';
    console.log(`${symbol} Call ${i}: ${errorCount} errors - MissingPartial: ${missingPartial ? 'YES' : 'NO'}`);
  }

  console.log('\nTest 2: Modify content (add a comment) and validate');
  console.log('─'.repeat(80));
  
  const modifiedContent = '<!-- test modification -->\n' + content;
  
  for (let i = 1; i <= 3; i++) {
    const result = await validateCodeTool.handler({ file_path: filePath, content: modifiedContent, mode: 'quick' });
    const errorCount = result.errors ? result.errors.length : 0;
    const missingPartial = result.errors.find(e => e.check === 'MissingPartial');
    const symbol = missingPartial ? '✅' : '❌';
    console.log(`${symbol} Call ${i+3} (modified): ${errorCount} errors - MissingPartial: ${missingPartial ? 'YES' : 'NO'}`);
  }

  console.log('\nTest 3: Revert to original content');
  console.log('─'.repeat(80));
  
  for (let i = 1; i <= 3; i++) {
    const result = await validateCodeTool.handler({ file_path: filePath, content, mode: 'quick' });
    const errorCount = result.errors ? result.errors.length : 0;
    const missingPartial = result.errors.find(e => e.check === 'MissingPartial');
    const symbol = missingPartial ? '✅' : '❌';
    console.log(`${symbol} Call ${i+6} (original): ${errorCount} errors - MissingPartial: ${missingPartial ? 'YES' : 'NO'}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('All tests completed.');
  process.exit(0);
}

testMissingPartialWithContentChanges().catch(e => {
  console.error(`❌ Test failed: ${e.message}`);
  process.exit(1);
});
