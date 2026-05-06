/**
 * Unit tests for `parseSinceParam` — the HTTP-side translator that maps
 * the `?since=<value>` query parameter to the tri-state contract used by
 * analytics-queries + case-base reporting paths.
 *
 * The parser sits at the HTTP boundary. Integration tests can't cover it
 * cleanly because the spawned-Node server can't open `bun:sqlite`, so the
 * analytics endpoints return 503 in that environment. A unit test on the
 * pure parser pins the contract every endpoint depends on.
 */

import { describe, test, expect } from 'bun:test';
import { parseSinceParam } from '../../src/http-server.js';

function urlWith(qs) {
  return new URL(`http://localhost/foo${qs}`);
}

describe('parseSinceParam tri-state contract', () => {
  test('absent ?since → undefined (meta default applies)', () => {
    expect(parseSinceParam(urlWith(''))).toBeUndefined();
    expect(parseSinceParam(urlWith('?other=1'))).toBeUndefined();
  });

  test('empty ?since → undefined', () => {
    expect(parseSinceParam(urlWith('?since='))).toBeUndefined();
  });

  test('?since=all → null (engine-state bypass marker)', () => {
    expect(parseSinceParam(urlWith('?since=all'))).toBeNull();
  });

  test('?since=<valid ISO> → the same ISO string', () => {
    const ts = '2026-04-30T12:00:00.000Z';
    expect(parseSinceParam(urlWith(`?since=${encodeURIComponent(ts)}`))).toBe(ts);
  });

  test('?since=<malformed> throws a 400-eligible Error', () => {
    // The thrown message must include "since must be" so http-server.js's
    // sinceErrorStatus() routes it as 400 rather than 500.
    expect(() => parseSinceParam(urlWith('?since=not-a-date'))).toThrow(/since must be/);
  });

  test('whitespace-only ?since is rejected', () => {
    // Date('   ') parses NaN → must throw.
    expect(() => parseSinceParam(urlWith('?since=%20%20%20'))).toThrow(/since must be/);
  });

  test('case-sensitivity: only literal "all" is the bypass', () => {
    // 'All' / 'ALL' must NOT collapse to null — strict matching avoids
    // accidental bypass from typos that happen to parse as a Date elsewhere.
    expect(() => parseSinceParam(urlWith('?since=All'))).toThrow();
    expect(() => parseSinceParam(urlWith('?since=ALL'))).toThrow();
  });

  test('non-ISO but Date-parseable strings are accepted (Date is lenient)', () => {
    // `new Date('2026-04-30')` parses to a valid date. The parser only
    // rejects strings that fail Date — it does not enforce strict ISO 8601.
    // This matches existing analytics flexibility (the SQL filter just
    // compares strings); pin the behaviour so it doesn't drift.
    expect(parseSinceParam(urlWith('?since=2026-04-30'))).toBe('2026-04-30');
  });
});
