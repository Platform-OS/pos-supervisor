#!/usr/bin/env node
/**
 * LSP vs pos-cli check parity test.
 *
 * Runs both diagnostic paths on every .liquid file in a project and reports
 * every difference. Use this to find gaps in the LSP diagnostic path.
 *
 * Usage:
 *   node tests/parity/lsp-vs-poscli.js [project-dir]
 *   node tests/parity/lsp-vs-poscli.js /home/user/Work/testing_skills/working
 *
 * Default project: tests/fixtures/project/
 */

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BIN = join(ROOT, 'bin', 'pos-supervisor.js');
const DEFAULT_PROJECT = join(ROOT, 'tests', 'fixtures', 'project');

const projectDir = process.argv[2] || DEFAULT_PROJECT;

if (!existsSync(projectDir)) {
  console.error(`Project directory not found: ${projectDir}`);
  process.exit(1);
}

console.log(`\n🔍 LSP vs pos-cli parity test`);
console.log(`   Project: ${projectDir}\n`);

// Find all liquid files
const appDir = join(projectDir, 'app');
const files = readdirSync(appDir, { recursive: true })
  .filter(f => f.endsWith('.liquid'))
  .map(f => `app/${f}`);

console.log(`   Files: ${files.length}\n`);

// Start server for LSP path
const proc = spawn('node', [BIN], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, POS_SUPERVISOR_PROJECT_DIR: projectDir, POS_SUPERVISOR_HTTP_PORT: '13779' },
});

proc.stderr.on('data', () => {});
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');

// Wait for server — poll health endpoint
await new Promise((resolve, reject) => {
  let attempts = 0;
  const check = async () => {
    attempts++;
    if (attempts > 100) { reject(new Error('Server startup timeout')); return; }
    try {
      const r = await fetch('http://localhost:13779/health');
      if (r.ok) { resolve(); return; }
    } catch {}
    setTimeout(check, 200);
  };
  setTimeout(check, 1000); // wait 1s before first poll
});

// Import check runner for pos-cli path
const { checkContent } = await import(join(ROOT, 'src', 'core', 'check-runner.js'));

// Results
const report = {
  files_tested: 0,
  identical: 0,
  lsp_only: [],      // diagnostics LSP found that pos-cli didn't
  cli_only: [],      // diagnostics pos-cli found that LSP didn't
  line_mismatches: [],
  severity_mismatches: [],
};

function diagKey(d) {
  return `${d.check}|${d.message?.slice(0, 60)}`;
}

function diagSummary(d) {
  return `L${d.line}:C${d.column} [${d.check}] ${d.message?.slice(0, 70)}`;
}

for (const filePath of files) {
  const absPath = join(projectDir, filePath);
  const content = readFileSync(absPath, 'utf8');

  // LSP path
  let lspDiags = [];
  try {
    const r = await fetch('http://localhost:13779/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'validate_code', params: { file_path: filePath, content, mode: 'quick' } }),
    });
    const result = (await r.json()).result;
    lspDiags = [...(result.errors ?? []), ...(result.warnings ?? [])];
  } catch (e) {
    console.error(`  LSP failed for ${filePath}: ${e.message}`);
  }

  // pos-cli path
  let cliDiags = [];
  try {
    const result = await checkContent({
      cmd: 'pos-cli',
      args: ['check', 'run', '-f', 'json'],
      directory: projectDir,
      filePath,
      content,
    });
    cliDiags = [...(result.errors ?? []), ...(result.warnings ?? [])];
  } catch (e) {
    console.error(`  pos-cli failed for ${filePath}: ${e.message}`);
  }

  report.files_tested++;

  // Compare
  const lspSet = new Map(lspDiags.map(d => [diagKey(d), d]));
  const cliSet = new Map(cliDiags.map(d => [diagKey(d), d]));

  let hasDiff = false;

  // LSP-only
  for (const [key, d] of lspSet) {
    if (!cliSet.has(key)) {
      report.lsp_only.push({ file: filePath, ...d });
      hasDiff = true;
    }
  }

  // pos-cli-only
  for (const [key, d] of cliSet) {
    if (!lspSet.has(key)) {
      report.cli_only.push({ file: filePath, ...d });
      hasDiff = true;
    }
  }

  // Line/severity mismatches for shared diagnostics
  for (const [key, lspD] of lspSet) {
    const cliD = cliSet.get(key);
    if (!cliD) continue;

    // Note: LSP diagnostics in our output are already +1 (1-based)
    // pos-cli check diagnostics from checkContent are still 0-based
    const lspLine = lspD.line;
    const cliLine = cliD.line + 1; // convert pos-cli 0-based to 1-based for comparison

    if (lspLine !== cliLine) {
      report.line_mismatches.push({
        file: filePath,
        check: lspD.check,
        lsp_line: lspLine,
        cli_line: cliLine,
        message: lspD.message?.slice(0, 60),
      });
      hasDiff = true;
    }

    if (lspD.severity !== cliD.severity) {
      report.severity_mismatches.push({
        file: filePath,
        check: lspD.check,
        lsp_severity: lspD.severity,
        cli_severity: cliD.severity,
        message: lspD.message?.slice(0, 60),
      });
      hasDiff = true;
    }
  }

  if (!hasDiff) report.identical++;

  // Progress
  const pct = Math.round((report.files_tested / files.length) * 100);
  process.stdout.write(`\r   Progress: ${report.files_tested}/${files.length} (${pct}%)`);
}

console.log('\n');

// Report
console.log('═══════════════════════════════════════════════════════════');
console.log('  PARITY REPORT');
console.log('═══════════════════════════════════════════════════════════\n');

console.log(`  Files tested:      ${report.files_tested}`);
console.log(`  Identical:         ${report.identical}`);
console.log(`  LSP-only findings: ${report.lsp_only.length}`);
console.log(`  pos-cli-only:      ${report.cli_only.length}`);
console.log(`  Line mismatches:   ${report.line_mismatches.length}`);
console.log(`  Severity mismatch: ${report.severity_mismatches.length}`);

if (report.lsp_only.length > 0) {
  console.log('\n── LSP-only (pos-cli does NOT report these) ─────────────\n');
  const grouped = {};
  for (const d of report.lsp_only) {
    const key = d.check;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(d);
  }
  for (const [check, items] of Object.entries(grouped)) {
    console.log(`  ${check} (${items.length}x)`);
    for (const d of items.slice(0, 5)) {
      console.log(`    ${d.file} L${d.line} — ${d.message?.slice(0, 60)}`);
    }
    if (items.length > 5) console.log(`    ... and ${items.length - 5} more`);
  }
}

if (report.cli_only.length > 0) {
  console.log('\n── pos-cli-only (LSP does NOT report these) ─────────────\n');
  const grouped = {};
  for (const d of report.cli_only) {
    const key = d.check;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(d);
  }
  for (const [check, items] of Object.entries(grouped)) {
    console.log(`  ${check} (${items.length}x)`);
    for (const d of items.slice(0, 5)) {
      console.log(`    ${d.file} L${d.line ?? '?'} — ${d.message?.slice(0, 60)}`);
    }
    if (items.length > 5) console.log(`    ... and ${items.length - 5} more`);
  }
}

if (report.line_mismatches.length > 0) {
  console.log('\n── Line number mismatches ───────────────────────────────\n');
  for (const m of report.line_mismatches.slice(0, 10)) {
    console.log(`  ${m.file} [${m.check}] LSP:L${m.lsp_line} vs CLI:L${m.cli_line} — ${m.message}`);
  }
  if (report.line_mismatches.length > 10) console.log(`  ... and ${report.line_mismatches.length - 10} more`);
}

if (report.severity_mismatches.length > 0) {
  console.log('\n── Severity mismatches ──────────────────────────────────\n');
  for (const m of report.severity_mismatches.slice(0, 10)) {
    console.log(`  ${m.file} [${m.check}] LSP:${m.lsp_severity} vs CLI:${m.cli_severity} — ${m.message}`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════\n');

// Verdict
const totalDiffs = report.lsp_only.length + report.cli_only.length + report.line_mismatches.length + report.severity_mismatches.length;
if (totalDiffs === 0) {
  console.log('✅ PERFECT PARITY — LSP and pos-cli produce identical results.\n');
} else {
  console.log(`⚠  ${totalDiffs} difference(s) found. Review each category above.\n`);
  console.log('  LSP-only findings may be acceptable (LSP is stricter).');
  console.log('  pos-cli-only findings are GAPS — errors the agent will miss.\n');
}

proc.kill();
