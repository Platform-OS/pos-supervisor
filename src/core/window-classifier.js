/**
 * Window classifier — compares consecutive validate_code results for the
 * same file to classify each diagnostic's outcome.
 *
 * A "window" is a pair of consecutive validate_code tool_call events for
 * the same (session, file). Within each window, every diagnostic from the
 * START call is classified as:
 *   - resolved:   fp present at start, absent at end
 *   - unchanged:  fp present at both start and end
 *   - moved:      template_fp present at end but fp changed (line shift)
 *   - regressed:  fp absent at start, present at end (new diagnostic)
 *
 * Fix adoption is classified by comparing content_hash blobs against
 * proposed_fix ranges:
 *   - verbatim:   proposed fix text applied exactly
 *   - partial:    content changed in the fix range but not exactly
 *   - ignored:    content in the fix range unchanged
 */

import { fingerprint, templateFingerprint, templateOf, extractParams } from './diagnostic-record.js';
import { createHash } from 'node:crypto';

/**
 * Extract validate_code tool_call events from a flat event list,
 * grouped by file in chronological order.
 */
export function extractValidateCodeCalls(events) {
  const byFile = new Map();

  for (const event of events) {
    if (event.kind !== 'tool_call') continue;
    if (event.tool !== 'validate_code') continue;
    if (!event.success) continue;

    const filePath = event.input?.file_path;
    if (!filePath) continue;

    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath).push(event);
  }

  return byFile;
}

/**
 * Build diagnostic fingerprint sets from a validate_code tool_call event.
 * Returns { fps: Set<string>, templateFps: Map<templateFp, fp[]>, diagnostics: DiagInfo[] }
 */
function buildDiagnosticSets(toolCallEvent) {
  const filePath = toolCallEvent.input?.file_path ?? '';
  const output = toolCallEvent.output ?? {};
  const allDiags = [...(output.errors ?? []), ...(output.warnings ?? [])];

  const fps = new Set();
  const templateFps = new Map();
  const diagnostics = [];

  for (const d of allDiags) {
    if (!d || !d.check) continue;
    const message = d.message ?? '';
    const msgTemplate = templateOf(d.check, message);
    const fp = fingerprint(d.check, filePath, msgTemplate);
    const tFp = templateFingerprint(d.check, msgTemplate);

    fps.add(fp);
    if (!templateFps.has(tFp)) templateFps.set(tFp, []);
    templateFps.get(tFp).push(fp);
    diagnostics.push({ fp, template_fp: tFp, check: d.check, message, line: d.line });
  }

  return { fps, templateFps, diagnostics };
}

/**
 * Classify outcomes for all diagnostics within one window.
 *
 * @param {object} startCall - The earlier validate_code tool_call event
 * @param {object} endCall   - The later validate_code tool_call event
 * @returns {object} { window, outcomes }
 */
export function classifyWindow(startCall, endCall) {
  const filePath = startCall.input?.file_path ?? '';
  const startSets = buildDiagnosticSets(startCall);
  const endSets = buildDiagnosticSets(endCall);

  const outcomes = [];

  for (const diag of startSets.diagnostics) {
    if (endSets.fps.has(diag.fp)) {
      outcomes.push({ fp: diag.fp, outcome: 'unchanged', check: diag.check });
    } else if (endSets.templateFps.has(diag.template_fp)) {
      outcomes.push({ fp: diag.fp, outcome: 'moved', check: diag.check });
    } else {
      outcomes.push({ fp: diag.fp, outcome: 'resolved', check: diag.check });
    }
  }

  for (const diag of endSets.diagnostics) {
    if (!startSets.fps.has(diag.fp) && !startSets.templateFps.has(diag.template_fp)) {
      outcomes.push({ fp: diag.fp, outcome: 'regressed', check: diag.check });
    }
  }

  const window = {
    file: filePath,
    session_id: startCall.session_id,
    ts_start: startCall.ts,
    ts_end: endCall.ts,
    content_hash_start: extractContentHash(startCall),
    content_hash_end: extractContentHash(endCall),
  };

  return { window, outcomes };
}

function extractContentHash(toolCallEvent) {
  const content = toolCallEvent.input?.content;
  if (!content) return null;
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Classify fix adoption by comparing start and end content against proposed fixes.
 *
 * @param {string|null} startContent - File content at window start
 * @param {string|null} endContent   - File content at window end
 * @param {Array} proposedFixes      - From validator_emit events: [{ range, new_text_hash }]
 * @param {object} blobStore         - Blob store for resolving content hashes
 * @returns {'verbatim'|'partial'|'ignored'|null}
 */
export function classifyFixAdoption(startContent, endContent, proposedFixes, blobStore) {
  if (!startContent || !endContent || !proposedFixes?.length || !blobStore) return null;
  if (startContent === endContent) return 'ignored';

  const endHash = createHash('sha256').update(endContent).digest('hex');
  const startHash = createHash('sha256').update(startContent).digest('hex');
  if (startHash === endHash) return 'ignored';

  for (const fix of proposedFixes) {
    if (!fix.new_text_hash) continue;
    const fixText = blobStore.getText(fix.new_text_hash);
    if (!fixText) continue;

    if (endContent.includes(fixText)) return 'verbatim';
  }

  return 'partial';
}

/**
 * Extract fs_watcher_sync events from the event list, grouped by relative file path.
 * These represent files written to disk by the agent (via Write/Edit tools or scaffold).
 * Requires fs-watcher.js to emit rel_path alongside path.
 *
 * @param {Array} events
 * @returns {Map<string, Array>} file → sorted write events
 */
export function extractWriteEvents(events) {
  const byFile = new Map();
  for (const event of events) {
    if (event.kind !== 'fs_watcher_sync') continue;
    const relPath = event.rel_path ?? null;
    if (!relPath) continue;
    if (!byFile.has(relPath)) byFile.set(relPath, []);
    byFile.get(relPath).push(event);
  }
  for (const writes of byFile.values()) {
    writes.sort((a, b) => (a.ts > b.ts ? 1 : a.ts < b.ts ? -1 : 0));
  }
  return byFile;
}

/**
 * Classify a write-closed window: the last validation before a file write
 * with no subsequent re-validation. Outcomes are 'write_unverified' because
 * we know the file changed on disk but cannot determine if diagnostics were
 * resolved without re-running validation.
 *
 * @param {object} validateCall - The last validate_code tool_call event
 * @param {object} writeEvent   - The fs_watcher_sync event that closed the window
 * @returns {{ window, outcomes }}
 */
export function classifyWriteWindow(validateCall, writeEvent) {
  const filePath = validateCall.input?.file_path ?? '';
  const startSets = buildDiagnosticSets(validateCall);

  const outcomes = startSets.diagnostics.map(diag => ({
    fp: diag.fp,
    outcome: 'write_unverified',
    check: diag.check,
  }));

  const window = {
    file: filePath,
    session_id: validateCall.session_id,
    ts_start: validateCall.ts,
    ts_end: writeEvent.ts,
    content_hash_start: extractContentHash(validateCall),
    content_hash_end: null,
    is_draft: false,
    closed_by: 'write',
  };

  return { window, outcomes };
}

/**
 * Build windows and classify outcomes for an entire session.
 *
 * Two window kinds:
 *  - validate-to-validate: consecutive validate_code calls for the same file.
 *    Tagged is_draft=true when no fs_watcher_sync (file write) falls between them,
 *    meaning the agent was comparing draft iterations without writing to disk.
 *  - write-closed: last validate_code call followed by a file write with no
 *    subsequent re-validation. Outcomes are 'write_unverified'.
 *
 * @param {Array} events       - All events for a session
 * @param {object} [emitIndex] - Map<fp, validator_emit[]> for fix adoption lookup
 * @returns {Array<{window, outcomes}>}
 */
export function classifySession(events, emitIndex) {
  const byFile = extractValidateCodeCalls(events);
  const writesByFile = extractWriteEvents(events);
  const results = [];

  for (const [file, calls] of byFile) {
    const fileWrites = writesByFile.get(file) ?? [];

    // ── Validate-to-validate windows ──────────────────────────────────
    for (let i = 0; i < calls.length - 1; i++) {
      const startCall = calls[i];
      const endCall = calls[i + 1];
      const { window, outcomes } = classifyWindow(startCall, endCall);
      window.idx = i;
      // A draft window is one where the agent iterated on content without
      // writing to disk between the two validations. These measure thinking,
      // not effectiveness — they should be excluded from rule scoring.
      const hasMidWrite = fileWrites.some(w => w.ts > startCall.ts && w.ts <= endCall.ts);
      window.is_draft = hasMidWrite ? 0 : 1;
      window.closed_by = 'validate';
      results.push({ window, outcomes });
    }

    // ── Write-closed window ───────────────────────────────────────────
    // If a write happened after the last validation, capture it as a window.
    // The agent wrote the file without re-validating, so we can't determine
    // outcomes precisely — use write_unverified for all active diagnostics.
    if (calls.length > 0) {
      const lastCall = calls[calls.length - 1];
      const postWrite = fileWrites.find(w => w.ts > lastCall.ts);
      if (postWrite) {
        const { window, outcomes } = classifyWriteWindow(lastCall, postWrite);
        window.idx = calls.length - 1;
        results.push({ window, outcomes });
      }
    }
  }

  return results;
}

/**
 * Build an emit index from events: Map<fp, validator_emit_event[]>.
 * Used for looking up proposed_fixes associated with a diagnostic.
 */
export function buildEmitIndex(events) {
  const index = new Map();
  for (const event of events) {
    if (event.kind !== 'validator_emit') continue;
    if (!index.has(event.fp)) index.set(event.fp, []);
    index.get(event.fp).push(event);
  }
  return index;
}

/**
 * Compute collateral for a set of outcomes: count of new diagnostics
 * introduced (regressed) minus resolved, clamped to 0.
 */
export function computeCollateral(outcomes) {
  let regressed = 0;
  let resolved = 0;
  for (const o of outcomes) {
    if (o.outcome === 'regressed') regressed++;
    if (o.outcome === 'resolved') resolved++;
  }
  return Math.max(0, regressed - resolved);
}
