import { describe, it, expect } from 'bun:test';
import { normalizeLspDiagnostics } from '../../src/core/lsp-client.js';

describe('normalizeLspDiagnostics', () => {
  it('maps severity 1 to error', () => {
    const result = normalizeLspDiagnostics([
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, code: 'UndefinedObject', message: 'test' }
    ], 'test.liquid');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].check).toBe('UndefinedObject');
    expect(result.errors[0].severity).toBe('error');
  });

  it('maps severity 2 to warning', () => {
    const result = normalizeLspDiagnostics([
      { range: { start: { line: 1, character: 3 }, end: { line: 1, character: 10 } }, severity: 2, code: 'OrphanedPartial', message: 'not used' }
    ], 'test.liquid');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].severity).toBe('warning');
  });

  it('maps severity 3 to info', () => {
    const result = normalizeLspDiagnostics([
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 3, code: 'hint', message: 'info' }
    ], 'test.liquid');
    expect(result.infos).toHaveLength(1);
  });

  it('extracts check name from code field', () => {
    const result = normalizeLspDiagnostics([
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 1, code: 'MissingPartial', message: 'msg' }
    ], 'test.liquid');
    expect(result.checks.has('MissingPartial')).toBe(true);
  });

  it('extracts line and column from range', () => {
    const result = normalizeLspDiagnostics([
      { range: { start: { line: 5, character: 12 }, end: { line: 5, character: 20 } }, severity: 1, code: 'X', message: 'm' }
    ], 'test.liquid');
    expect(result.errors[0].line).toBe(5);
    expect(result.errors[0].column).toBe(12);
    expect(result.errors[0].endLine).toBe(5);
    expect(result.errors[0].endColumn).toBe(20);
  });

  it('handles empty diagnostics array', () => {
    const result = normalizeLspDiagnostics([], 'test.liquid');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.infos).toHaveLength(0);
  });

  it('sets _filePath on each diagnostic', () => {
    const result = normalizeLspDiagnostics([
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 1, code: 'X', message: 'm' }
    ], 'app/views/pages/test.liquid');
    expect(result.errors[0]._filePath).toBe('app/views/pages/test.liquid');
  });
});
