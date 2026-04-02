#!/usr/bin/env node
/**
 * Test each platformOS LSP setting individually to understand their effects
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PlatformOSLSPClient } from '../../src/core/lsp-client.js';
import { toUri } from '../../src/core/utils.js';

const projectDir = resolve('/home/ecgtheow/Work/pos-ai-tools/pos-mcp/tests/fixtures/broken-project');

async function testSettings() {
  console.log(`\n🔍 Testing platformOS LSP InitializationOptions\n`);

  const tests = [
    {
      name: 'Current (only includeFilesFromDisk)',
      initOptions: {
        'platformosCheck.includeFilesFromDisk': true,
      },
    },
    {
      name: 'Current + preloadOnBoot',
      initOptions: {
        'platformosCheck.includeFilesFromDisk': true,
        'platformosCheck.preloadOnBoot': true,
      },
    },
    {
      name: 'Current + disabled auto-checks',
      initOptions: {
        'platformosCheck.includeFilesFromDisk': true,
        'platformosCheck.checkOnOpen': false,
        'platformosCheck.checkOnSave': false,
        'platformosCheck.checkOnChange': false,
      },
    },
    {
      name: 'All settings combined',
      initOptions: {
        'platformosCheck.includeFilesFromDisk': true,
        'platformosCheck.preloadOnBoot': true,
        'platformosCheck.checkOnOpen': false,
        'platformosCheck.checkOnSave': false,
        'platformosCheck.checkOnChange': false,
      },
    },
  ];

  for (const test of tests) {
    console.log(`Testing: ${test.name}`);
    console.log(`Settings: ${JSON.stringify(test.initOptions)}`);

    const lsp = new PlatformOSLSPClient();
    lsp.start('pos-cli', ['lsp']);

    const startInit = Date.now();
    try {
      await Promise.race([
        lsp.initialize(toUri(projectDir)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Init timeout')), 10000)),
      ]);
    } catch (e) {
      console.log(`❌ Initialization failed: ${e.message}`);
      lsp.stop();
      continue;
    }
    const initTime = Date.now() - startInit;

    console.log(`✓ Initialized in ${initTime}ms`);

    // Try a quick diagnostic
    const filePath = 'app/views/pages/products/index.html.liquid';
    const content = readFileSync(resolve(projectDir, filePath), 'utf8');
    const fileUri = toUri(resolve(projectDir, filePath));

    const startDiag = Date.now();
    try {
      const diags = await Promise.race([
        lsp.awaitDiagnostics(fileUri, content, 5000),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Diagnostic timeout')), 8000)),
      ]);
      const diagTime = Date.now() - startDiag;
      const hasMissing = diags.some(d => d.code?.includes('MissingPartial'));
      console.log(`✓ Diagnostic in ${diagTime}ms (MissingPartial: ${hasMissing ? '✓' : '✗'})`);
    } catch (e) {
      console.log(`❌ Diagnostic failed: ${e.message}`);
    }

    lsp.stop();
    console.log();
  }

  process.exit(0);
}

testSettings().catch(e => {
  console.error(`❌ Test failed: ${e.message}`);
  process.exit(1);
});
