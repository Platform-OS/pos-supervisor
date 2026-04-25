import { describe, test, expect } from 'bun:test';
import {
  extractValidateCodeCalls,
  classifyWindow,
  classifyFixAdoption,
  classifySession,
  classifyWriteWindow,
  extractWriteEvents,
  buildEmitIndex,
  computeCollateral,
} from '../../src/core/window-classifier.js';

function makeVcCall(overrides = {}) {
  return {
    kind: 'tool_call',
    tool: 'validate_code',
    success: true,
    session_id: 'sess1',
    ts: '2026-04-17T10:00:00Z',
    input: {
      file_path: 'app/views/pages/index.html.liquid',
      content: '{% render "blog_posts/card" %}',
      ...overrides.input,
    },
    output: {
      errors: [],
      warnings: [],
      ...overrides.output,
    },
    ...overrides,
  };
}

function makeDiag(check, message, line = 1) {
  return { check, message, severity: 'error', line };
}

describe('extractValidateCodeCalls', () => {
  test('groups calls by file', () => {
    const events = [
      makeVcCall({ ts: 't1' }),
      makeVcCall({ ts: 't2', input: { file_path: 'other.liquid', content: '' } }),
      makeVcCall({ ts: 't3' }),
    ];
    const byFile = extractValidateCodeCalls(events);
    expect(byFile.size).toBe(2);
    expect(byFile.get('app/views/pages/index.html.liquid')).toHaveLength(2);
    expect(byFile.get('other.liquid')).toHaveLength(1);
  });

  test('skips failed calls', () => {
    const events = [
      makeVcCall({ success: false }),
      makeVcCall({ ts: 't2' }),
    ];
    const byFile = extractValidateCodeCalls(events);
    expect(byFile.get('app/views/pages/index.html.liquid')).toHaveLength(1);
  });

  test('skips non-validate_code events', () => {
    const events = [
      { kind: 'tool_call', tool: 'scaffold', success: true, ts: 't1', input: {}, output: {} },
      makeVcCall(),
    ];
    const byFile = extractValidateCodeCalls(events);
    expect(byFile.size).toBe(1);
  });
});

describe('classifyWindow', () => {
  test('resolved: diagnostic disappears between calls', () => {
    const start = makeVcCall({
      output: { errors: [makeDiag('MissingPartial', "Missing partial 'blog_posts/card'")], warnings: [] },
    });
    const end = makeVcCall({
      ts: '2026-04-17T10:01:00Z',
      output: { errors: [], warnings: [] },
    });
    const { window, outcomes } = classifyWindow(start, end);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('resolved');
    expect(outcomes[0].check).toBe('MissingPartial');
    expect(window.file).toBe('app/views/pages/index.html.liquid');
  });

  test('unchanged: diagnostic persists', () => {
    const diag = makeDiag('MissingPartial', "Missing partial 'blog_posts/card'");
    const start = makeVcCall({ output: { errors: [diag], warnings: [] } });
    const end = makeVcCall({ ts: 't2', output: { errors: [diag], warnings: [] } });
    const { outcomes } = classifyWindow(start, end);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('unchanged');
  });

  test('moved: same template_fp but different fp (cross-file)', () => {
    const start = makeVcCall({
      output: { errors: [makeDiag('MissingPartial', "Missing partial 'blog_posts/card'")], warnings: [] },
    });
    const end = makeVcCall({
      ts: 't2',
      input: { file_path: 'app/views/pages/other.html.liquid', content: '' },
      output: { errors: [makeDiag('MissingPartial', "Missing partial 'blog_posts/card'")], warnings: [] },
    });
    const { outcomes } = classifyWindow(start, end);
    expect(outcomes.some(o => o.outcome === 'moved')).toBe(true);
  });

  test('regressed: new diagnostic at end', () => {
    const start = makeVcCall({ output: { errors: [], warnings: [] } });
    const end = makeVcCall({
      ts: 't2',
      output: { errors: [makeDiag('UndefinedObject', "The object 'foo' is undefined")], warnings: [] },
    });
    const { outcomes } = classifyWindow(start, end);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('regressed');
  });

  test('mixed: one resolved, one unchanged, one regressed', () => {
    const start = makeVcCall({
      output: {
        errors: [
          makeDiag('MissingPartial', "Missing partial 'blog_posts/card'"),
          makeDiag('UndefinedObject', "The object 'item' is undefined"),
        ],
        warnings: [],
      },
    });
    const end = makeVcCall({
      ts: 't2',
      output: {
        errors: [
          makeDiag('UndefinedObject', "The object 'item' is undefined"),
          makeDiag('UnknownFilter', "Unknown filter 'money'"),
        ],
        warnings: [],
      },
    });
    const { outcomes } = classifyWindow(start, end);

    const resolved = outcomes.filter(o => o.outcome === 'resolved');
    const unchanged = outcomes.filter(o => o.outcome === 'unchanged');
    const regressed = outcomes.filter(o => o.outcome === 'regressed');

    expect(resolved).toHaveLength(1);
    expect(resolved[0].check).toBe('MissingPartial');
    expect(unchanged).toHaveLength(1);
    expect(unchanged[0].check).toBe('UndefinedObject');
    expect(regressed).toHaveLength(1);
    expect(regressed[0].check).toBe('UnknownFilter');
  });

  test('window timestamps are correct', () => {
    const start = makeVcCall({ ts: '2026-04-17T10:00:00Z', output: { errors: [], warnings: [] } });
    const end = makeVcCall({ ts: '2026-04-17T10:05:00Z', output: { errors: [], warnings: [] } });
    const { window } = classifyWindow(start, end);
    expect(window.ts_start).toBe('2026-04-17T10:00:00Z');
    expect(window.ts_end).toBe('2026-04-17T10:05:00Z');
    expect(window.session_id).toBe('sess1');
  });
});

describe('classifyFixAdoption', () => {
  const mockBlobStore = {
    getText(hash) {
      if (hash === 'fix1') return '<a href="{{ \'/products\' | append: product.id }}">View</a>';
      return null;
    },
  };

  test('returns ignored when content unchanged', () => {
    const content = '<p>Hello</p>';
    expect(classifyFixAdoption(content, content, [{ new_text_hash: 'fix1' }], mockBlobStore)).toBe('ignored');
  });

  test('returns verbatim when fix text found in end content', () => {
    const start = '<a href="/products/123">View</a>';
    const end = '<a href="{{ \'/products\' | append: product.id }}">View</a>';
    const result = classifyFixAdoption(start, end, [{ new_text_hash: 'fix1' }], mockBlobStore);
    expect(result).toBe('verbatim');
  });

  test('returns partial when content changed but fix not applied verbatim', () => {
    const start = '<a href="/products/123">View</a>';
    const end = '<a href="/items/123">View</a>';
    const result = classifyFixAdoption(start, end, [{ new_text_hash: 'fix1' }], mockBlobStore);
    expect(result).toBe('partial');
  });

  test('returns null when no proposed fixes', () => {
    expect(classifyFixAdoption('a', 'b', [], mockBlobStore)).toBeNull();
  });

  test('returns null when no blob store', () => {
    expect(classifyFixAdoption('a', 'b', [{ new_text_hash: 'x' }], null)).toBeNull();
  });
});

function makeWriteEvent(relPath, ts) {
  return { kind: 'fs_watcher_sync', rel_path: relPath, ts };
}

describe('extractWriteEvents', () => {
  test('groups by rel_path', () => {
    const events = [
      makeWriteEvent('app/views/pages/a.liquid', 't1'),
      makeWriteEvent('app/views/pages/b.liquid', 't2'),
      makeWriteEvent('app/views/pages/a.liquid', 't3'),
    ];
    const writes = extractWriteEvents(events);
    expect(writes.size).toBe(2);
    expect(writes.get('app/views/pages/a.liquid')).toHaveLength(2);
    expect(writes.get('app/views/pages/b.liquid')).toHaveLength(1);
  });

  test('returns empty map for no write events', () => {
    const events = [makeVcCall()];
    expect(extractWriteEvents(events).size).toBe(0);
  });

  test('ignores events without rel_path', () => {
    const events = [{ kind: 'fs_watcher_sync', path: '/abs/path/file.liquid', ts: 't1' }];
    expect(extractWriteEvents(events).size).toBe(0);
  });

  test('sorts events chronologically per file', () => {
    const events = [
      makeWriteEvent('app/views/pages/a.liquid', '2026-04-17T10:02:00Z'),
      makeWriteEvent('app/views/pages/a.liquid', '2026-04-17T10:01:00Z'),
    ];
    const writes = extractWriteEvents(events);
    const sorted = writes.get('app/views/pages/a.liquid');
    expect(sorted[0].ts).toBe('2026-04-17T10:01:00Z');
    expect(sorted[1].ts).toBe('2026-04-17T10:02:00Z');
  });
});

describe('classifyWriteWindow', () => {
  const FILE = 'app/views/pages/index.html.liquid';

  test('produces write_unverified outcomes for all diagnostics', () => {
    const vc = makeVcCall({
      ts: '2026-04-17T10:00:00Z',
      output: {
        errors: [
          makeDiag('MissingPartial', "Missing partial 'blog_posts/card'"),
          makeDiag('UndefinedObject', "The object 'item' is undefined"),
        ],
        warnings: [],
      },
    });
    const write = makeWriteEvent(FILE, '2026-04-17T10:01:00Z');
    const { window, outcomes } = classifyWriteWindow(vc, write);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.every(o => o.outcome === 'write_unverified')).toBe(true);
    expect(window.closed_by).toBe('write');
    expect(window.is_draft).toBe(false);
    expect(window.ts_end).toBe('2026-04-17T10:01:00Z');
    expect(window.content_hash_end).toBeNull();
  });

  test('produces empty outcomes when validation was clean', () => {
    const vc = makeVcCall({ output: { errors: [], warnings: [] } });
    const write = makeWriteEvent(FILE, 't2');
    const { outcomes } = classifyWriteWindow(vc, write);
    expect(outcomes).toHaveLength(0);
  });
});

describe('classifySession', () => {
  const FILE = 'app/views/pages/index.html.liquid';

  test('builds windows for files with multiple calls', () => {
    const events = [
      makeVcCall({
        ts: 't1',
        output: { errors: [makeDiag('MissingPartial', "Missing partial 'blog_posts/card'")], warnings: [] },
      }),
      makeVcCall({
        ts: 't2',
        output: { errors: [], warnings: [] },
      }),
    ];
    const results = classifySession(events);
    expect(results).toHaveLength(1);
    expect(results[0].outcomes).toHaveLength(1);
    expect(results[0].outcomes[0].outcome).toBe('resolved');
  });

  test('skips files with only one call and no write event', () => {
    const events = [makeVcCall()];
    const results = classifySession(events);
    expect(results).toHaveLength(0);
  });

  test('creates N-1 windows for N calls to same file (no writes)', () => {
    const events = [
      makeVcCall({ ts: 't1', output: { errors: [], warnings: [] } }),
      makeVcCall({ ts: 't2', output: { errors: [], warnings: [] } }),
      makeVcCall({ ts: 't3', output: { errors: [], warnings: [] } }),
    ];
    const results = classifySession(events);
    expect(results).toHaveLength(2);
    expect(results[0].window.idx).toBe(0);
    expect(results[1].window.idx).toBe(1);
  });

  test('validate-to-validate windows are tagged is_draft=1 when no write between them', () => {
    const events = [
      makeVcCall({ ts: '2026-04-17T10:00:00Z', output: { errors: [], warnings: [] } }),
      makeVcCall({ ts: '2026-04-17T10:01:00Z', output: { errors: [], warnings: [] } }),
    ];
    const results = classifySession(events);
    expect(results[0].window.is_draft).toBe(1);
    expect(results[0].window.closed_by).toBe('validate');
  });

  test('validate-to-validate windows are tagged is_draft=0 when write falls between them', () => {
    const events = [
      makeVcCall({ ts: '2026-04-17T10:00:00Z', output: { errors: [], warnings: [] } }),
      makeWriteEvent(FILE, '2026-04-17T10:00:30Z'),
      makeVcCall({ ts: '2026-04-17T10:01:00Z', output: { errors: [], warnings: [] } }),
    ];
    const results = classifySession(events);
    // One validate-to-validate window, no write after last validate
    expect(results).toHaveLength(1);
    expect(results[0].window.is_draft).toBe(0);
  });

  test('creates write-closed window for validate then write (no re-validate)', () => {
    const events = [
      makeVcCall({
        ts: '2026-04-17T10:00:00Z',
        output: { errors: [makeDiag('MissingPartial', "Missing partial 'x'")], warnings: [] },
      }),
      makeWriteEvent(FILE, '2026-04-17T10:01:00Z'),
    ];
    const results = classifySession(events);
    expect(results).toHaveLength(1);
    expect(results[0].window.closed_by).toBe('write');
    expect(results[0].outcomes[0].outcome).toBe('write_unverified');
  });

  test('creates both validate-to-validate and write-closed window for full multi-draft sequence', () => {
    // Draft 1 → Draft 2 → write
    const events = [
      makeVcCall({
        ts: '2026-04-17T10:00:00Z',
        output: { errors: [makeDiag('MissingPartial', "Missing partial 'x'")], warnings: [] },
      }),
      makeVcCall({
        ts: '2026-04-17T10:01:00Z',
        output: { errors: [makeDiag('MissingPartial', "Missing partial 'x'")], warnings: [] },
      }),
      makeWriteEvent(FILE, '2026-04-17T10:02:00Z'),
    ];
    const results = classifySession(events);
    expect(results).toHaveLength(2);

    const validateWindow = results.find(r => r.window.closed_by === 'validate');
    const writeWindow = results.find(r => r.window.closed_by === 'write');

    expect(validateWindow).toBeDefined();
    expect(validateWindow.window.is_draft).toBe(1);  // no write between the two validates
    expect(writeWindow).toBeDefined();
    expect(writeWindow.outcomes[0].outcome).toBe('write_unverified');
  });

  test('proper workflow: validate → write → re-validate produces non-draft window + no write-closed', () => {
    // The ideal agent workflow
    const events = [
      makeVcCall({
        ts: '2026-04-17T10:00:00Z',
        output: { errors: [makeDiag('MissingPartial', "Missing partial 'x'")], warnings: [] },
      }),
      makeWriteEvent(FILE, '2026-04-17T10:01:00Z'),
      makeVcCall({
        ts: '2026-04-17T10:02:00Z',
        output: { errors: [], warnings: [] },
      }),
    ];
    const results = classifySession(events);
    // One validate-to-validate window (write falls between → is_draft=0 → resolved)
    // No write after last validate → no write-closed window
    expect(results).toHaveLength(1);
    expect(results[0].window.is_draft).toBe(0);
    expect(results[0].window.closed_by).toBe('validate');
    expect(results[0].outcomes[0].outcome).toBe('resolved');
  });
});

describe('buildEmitIndex', () => {
  test('groups validator_emit events by fp', () => {
    const events = [
      { kind: 'validator_emit', fp: 'a', proposed_fixes: [] },
      { kind: 'validator_emit', fp: 'a', proposed_fixes: [{ new_text_hash: 'x' }] },
      { kind: 'validator_emit', fp: 'b', proposed_fixes: [] },
      { kind: 'tool_call', tool: 'validate_code' },
    ];
    const index = buildEmitIndex(events);
    expect(index.size).toBe(2);
    expect(index.get('a')).toHaveLength(2);
    expect(index.get('b')).toHaveLength(1);
  });
});

describe('computeCollateral', () => {
  test('counts net new regressions', () => {
    const outcomes = [
      { outcome: 'resolved' },
      { outcome: 'regressed' },
      { outcome: 'regressed' },
      { outcome: 'regressed' },
    ];
    expect(computeCollateral(outcomes)).toBe(2);
  });

  test('returns 0 when resolved >= regressed', () => {
    const outcomes = [
      { outcome: 'resolved' },
      { outcome: 'resolved' },
      { outcome: 'regressed' },
    ];
    expect(computeCollateral(outcomes)).toBe(0);
  });

  test('returns 0 for all unchanged', () => {
    expect(computeCollateral([{ outcome: 'unchanged' }, { outcome: 'unchanged' }])).toBe(0);
  });
});
