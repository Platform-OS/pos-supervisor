import { execFile } from 'node:child_process';
import { writeFile, unlink, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { findProjectRoot } from './utils.js';

const CHECK_TIMEOUT_MS = 60_000;

/**
 * Normalize severity values from pos-cli check output.
 */
function normSev(s) {
  if (s === 'error'   || s === 2) return 'error';
  if (s === 'warning' || s === 1) return 'warning';
  return 'info';
}

/**
 * Parse raw JSON output from pos-cli check run into structured result.
 */
function parseCheckResult(json, filterFile = null) {
  if (!json?.files?.length) return { errors: [], warnings: [], infos: [], checks: new Set() };

  const errors = [];
  const warnings = [];
  const infos = [];
  const checks = new Set();

  for (const file of json.files) {
    if (filterFile && !filterFile.endsWith(file.path) && file.path !== filterFile) continue;

    for (const o of file.offenses ?? []) {
      const sev = normSev(o.severity);
      const diagnostic = {
        check: o.check,
        severity: sev,
        message: o.message,
        line: (o.start_row ?? o.start?.line ?? 0),
        column: (o.start_column ?? o.start?.character ?? 0),
        endLine: o.end_row ?? o.end?.line ?? null,
        endColumn: o.end_column ?? o.end?.character ?? null,
        _filePath: file.path,
      };
      if (o.check) checks.add(o.check);

      if (sev === 'error') errors.push(diagnostic);
      else if (sev === 'warning') warnings.push(diagnostic);
      else infos.push(diagnostic);
    }
  }

  return { errors, warnings, infos, checks };
}

/**
 * Create a check runner that invokes pos-cli check run.
 *
 * @param {object} opts
 * @param {string} opts.cmd - Command to run (e.g. 'pos-cli' or 'node')
 * @param {string[]} opts.args - Args for pos-cli check (e.g. ['check', 'run', '-f', 'json'])
 * @param {string} opts.directory - Project root directory
 * @param {Function} [opts.log] - Logger function
 */
export function createCheckRunner({ cmd, args, directory, log }) {
  /**
   * Run pos-cli check on a specific file.
   * @param {string|null} filterFile - Absolute path to filter results to, or null for full project
   * @returns {Promise<{errors: Array, warnings: Array, infos: Array, checks: Set}>}
   */
  return function runCheck(filterFile = null) {
    return new Promise((resolve) => {
      const cwd = (filterFile && findProjectRoot(filterFile)) ?? directory;
      execFile(
        cmd,
        args,
        { env: process.env, cwd, maxBuffer: 10 * 1024 * 1024, timeout: CHECK_TIMEOUT_MS },
        (err, stdout) => {
          try {
            const json = JSON.parse(stdout);
            resolve(parseCheckResult(json, filterFile));
          } catch (e) {
            const msg = err?.killed ? 'pos-cli check timed out' : (err?.message ?? e.message);
            log?.(`pos-cli check failed: ${msg}`);
            resolve({ errors: [], warnings: [], infos: [], checks: new Set(), failed: true, error: msg });
          }
        }
      );
    });
  };
}

/**
 * Run pos-cli check on content that hasn't been written to disk yet.
 * Writes to a temp file, runs the check, then cleans up.
 *
 * @param {object} opts
 * @param {string} opts.cmd
 * @param {string[]} opts.args
 * @param {string} opts.directory - Project root
 * @param {string} opts.filePath - The intended file path (relative or absolute)
 * @param {string} opts.content - File content to validate
 * @param {Function} [opts.log]
 * @returns {Promise<{errors: Array, warnings: Array, infos: Array, checks: Set}>}
 */
export async function checkContent({ cmd, args, directory, filePath, content, log }) {
  // Write content to the actual target path temporarily so pos-cli check
  // can resolve it within the project context. If the file already exists,
  // we back it up to a temp file on disk (crash-safe) and restore after.
  const absPath = filePath.startsWith('/') ? filePath : join(directory, filePath);
  const backupPath = join(tmpdir(), `pos-supervisor-backup-${randomUUID()}`);
  let hadFile = false;

  try {
    try {
      await copyFile(absPath, backupPath);
      hadFile = true;
    } catch {
      // File doesn't exist yet — that's fine
    }

    await writeFile(absPath, content, 'utf8');

    const runner = createCheckRunner({ cmd, args, directory, log });
    const result = await runner(absPath);
    return result;
  } finally {
    try {
      if (hadFile) {
        await copyFile(backupPath, absPath);
        await unlink(backupPath).catch(() => {});
      } else {
        await unlink(absPath);
      }
    } catch {
      // Best effort cleanup
    }
  }
}
