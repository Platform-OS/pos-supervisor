import { describe, it, expect } from 'bun:test';

// Replicate the updateSession logic for unit testing
function updateSession(session, toolName, args, result) {
  if (!session) return;
  if (toolName === 'validate_intent' && result?.ok === true) {
    session.validatedPlan = {
      planId: result.plan_id,
      pendingFiles: new Set(result.pending_files ?? []),
      validatedFiles: new Set(),
    };
  }
  if (toolName === 'validate_code' && args?.file_path) {
    const fp = args.file_path;
    const errorCount = result?.errors?.length ?? 0;
    const prev = session.fileHistory.get(fp);
    if (prev) {
      prev.calls++;
      if (errorCount >= prev.lastErrorCount && prev.lastErrorCount > 0) {
        prev.consecutiveNonDecreasing++;
      } else {
        prev.consecutiveNonDecreasing = 0;
      }
      prev.lastErrorCount = errorCount;
    } else {
      session.fileHistory.set(fp, { calls: 1, lastErrorCount: errorCount, consecutiveNonDecreasing: 0 });
    }
    if (session.validatedPlan) {
      session.validatedPlan.validatedFiles.add(fp);
    }
  }
}

describe('updateSession — file history tracking', () => {
  it('initializes file history on first validate_code call', () => {
    const session = { fileHistory: new Map(), validatedPlan: null };
    updateSession(session, 'validate_code', { file_path: 'app/test.liquid' }, { errors: [{ check: 'X' }] });
    const h = session.fileHistory.get('app/test.liquid');
    expect(h.calls).toBe(1);
    expect(h.lastErrorCount).toBe(1);
    expect(h.consecutiveNonDecreasing).toBe(0);
  });

  it('increments consecutiveNonDecreasing when errors persist', () => {
    const session = { fileHistory: new Map(), validatedPlan: null };
    updateSession(session, 'validate_code', { file_path: 'f.liquid' }, { errors: [{ check: 'X' }] });
    updateSession(session, 'validate_code', { file_path: 'f.liquid' }, { errors: [{ check: 'X' }] });
    updateSession(session, 'validate_code', { file_path: 'f.liquid' }, { errors: [{ check: 'X' }] });
    const h = session.fileHistory.get('f.liquid');
    expect(h.calls).toBe(3);
    expect(h.consecutiveNonDecreasing).toBe(2);
  });

  it('resets consecutiveNonDecreasing when errors decrease', () => {
    const session = { fileHistory: new Map(), validatedPlan: null };
    updateSession(session, 'validate_code', { file_path: 'f.liquid' }, { errors: [{ check: 'X' }, { check: 'Y' }] });
    updateSession(session, 'validate_code', { file_path: 'f.liquid' }, { errors: [{ check: 'X' }, { check: 'Y' }] });
    expect(session.fileHistory.get('f.liquid').consecutiveNonDecreasing).toBe(1);
    updateSession(session, 'validate_code', { file_path: 'f.liquid' }, { errors: [{ check: 'X' }] });
    expect(session.fileHistory.get('f.liquid').consecutiveNonDecreasing).toBe(0);
  });

  it('resets when errors reach zero', () => {
    const session = { fileHistory: new Map(), validatedPlan: null };
    updateSession(session, 'validate_code', { file_path: 'f.liquid' }, { errors: [{ check: 'X' }] });
    updateSession(session, 'validate_code', { file_path: 'f.liquid' }, { errors: [{ check: 'X' }] });
    updateSession(session, 'validate_code', { file_path: 'f.liquid' }, { errors: [] });
    expect(session.fileHistory.get('f.liquid').consecutiveNonDecreasing).toBe(0);
  });
});

describe('updateSession — plan tracking', () => {
  it('registers plan on validate_intent success', () => {
    const session = { fileHistory: new Map(), validatedPlan: null };
    updateSession(session, 'validate_intent', {}, { ok: true, plan_id: 'abc', pending_files: ['a.liquid', 'b.liquid'] });
    expect(session.validatedPlan).toBeDefined();
    expect(session.validatedPlan.planId).toBe('abc');
    expect(session.validatedPlan.pendingFiles.size).toBe(2);
  });

  it('does not register plan on validate_intent failure', () => {
    const session = { fileHistory: new Map(), validatedPlan: null };
    updateSession(session, 'validate_intent', {}, { ok: false, errors: [] });
    expect(session.validatedPlan).toBeNull();
  });

  it('marks file as validated in current plan', () => {
    const session = { fileHistory: new Map(), validatedPlan: null };
    updateSession(session, 'validate_intent', {}, { ok: true, plan_id: 'p1', pending_files: ['a.liquid', 'b.liquid'] });
    updateSession(session, 'validate_code', { file_path: 'a.liquid' }, { errors: [] });
    expect(session.validatedPlan.validatedFiles.has('a.liquid')).toBe(true);
    expect(session.validatedPlan.validatedFiles.has('b.liquid')).toBe(false);
  });
});
