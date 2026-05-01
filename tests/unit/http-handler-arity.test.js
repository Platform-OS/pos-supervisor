/**
 * Static guard against the "caller passes the wrong number of args to an
 * analytics handler" class of bug.
 *
 * Phase 5 (`since` parameter wiring) widened the signatures of three
 * analytics handlers (`handleFixAdoptionFunnel`, `handleKnowledgeGaps`,
 * `handleRuleHeatmap`) from `(store, res)` to `(store, url, res)`. Two
 * other handlers were never widened during a follow-up review
 * (`handleAnalyticsSessions`, `handleSuggestedRules`), and the matching
 * call sites silently passed `(store, res)`. Bun runtime then evaluates
 * `sendJson(res, ...)` with `res === undefined`, which throws a
 * `TypeError: undefined is not an object (evaluating 'res.writeHead')` —
 * the entire HTTP listener dies inside the request handler, leaving the
 * MCP stdio process alive but the dashboard offline.
 *
 * The unit-test surface for that bug is awkward (handlers take real
 * `req`/`res` streams). A static-source check is cheap, deterministic,
 * and covers every analytics handler at once: read http-server.js as
 * text, extract every handler's parameter count from its declaration,
 * extract every call site's argument count from `return handleX(...)`,
 * and assert they match.
 *
 * If you add a new handler, you don't need to touch this test — it
 * discovers handlers + call sites by pattern.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(import.meta.dir, '..', '..', 'src', 'http-server.js'),
  'utf8',
);

/**
 * Parse "function handleX(a, b, c) { ... }" declarations.
 * Returns Map<handlerName, paramCount>. Async-function declarations
 * are supported; rest params (...x) are intentionally counted as 1
 * because we don't dispatch with spread syntax.
 */
function extractHandlerArities(src) {
  const re = /function\s+(handle[A-Za-z]+)\s*\(([^)]*)\)/g;
  const out = new Map();
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const paramList = m[2].trim();
    const arity = paramList === '' ? 0 : paramList.split(',').filter(Boolean).length;
    out.set(name, arity);
  }
  return out;
}

/**
 * Parse "return handleX(a, b, c)" call sites. Tolerates whitespace and
 * matches up to the closing paren on the same line — every analytics
 * dispatch is a single-line return.
 */
function extractCallSites(src) {
  const re = /return\s+(handle[A-Za-z]+)\s*\(([^)]*)\)/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const argList = m[2].trim();
    const arity = argList === '' ? 0 : argList.split(',').filter(Boolean).length;
    // Compute the source line for nicer test failures.
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ name, arity, line });
  }
  return out;
}

describe('http-server.js handler dispatch arity', () => {
  const arities = extractHandlerArities(SRC);
  const callSites = extractCallSites(SRC);

  test('handler declarations are discovered', () => {
    // Sanity check the parser — http-server is large enough that we
    // expect dozens of analytics handlers. If this drops to zero, the
    // regex broke and the rest of the suite is silently green-on-zero.
    expect(arities.size).toBeGreaterThan(20);
  });

  test('every analytics call site uses the declared arity', () => {
    // Restrict to analytics handlers — the other handlers in this file
    // have varied signatures (some take projectDir, some take body,
    // etc.) and aren't part of the Phase 5 surface this guard protects.
    const ANALYTICS_PREFIXES = [
      'handleAnalytics',
      'handleRule',
      'handleFixRule',
      'handleConfidence',
      'handleFixAdoption',
      'handleKnowledge',
      'handleDiagnostic',
      'handleSuggested',
      'handleCases',
    ];
    const isAnalyticsHandler = (name) =>
      ANALYTICS_PREFIXES.some(prefix => name.startsWith(prefix));

    const mismatches = [];
    for (const { name, arity, line } of callSites) {
      if (!isAnalyticsHandler(name)) continue;
      const declared = arities.get(name);
      if (declared == null) continue; // imported handler — not declared in this file
      if (declared !== arity) {
        mismatches.push(
          `http-server.js:${line} — return ${name}(...) passes ${arity} args, but ${name}() declares ${declared} parameters`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('every analytics handler that takes `url` actually uses it', () => {
    // Belt-and-braces: catch the inverse — a handler whose signature
    // declares (store, url, res) but whose body never references `url`
    // is a dead parameter that probably indicates a broken refactor.
    const ANALYTICS_NAMES = [...arities.keys()].filter(n =>
      n.startsWith('handleAnalytics') ||
      n.startsWith('handleRule') ||
      n.startsWith('handleFixRule') ||
      n.startsWith('handleConfidence') ||
      n.startsWith('handleFixAdoption') ||
      n.startsWith('handleKnowledge') ||
      n.startsWith('handleDiagnostic') ||
      n.startsWith('handleSuggested') ||
      n.startsWith('handleCases')
    );
    const dead = [];
    for (const name of ANALYTICS_NAMES) {
      // Find the function body — slice from declaration to end of file
      // and stop at the next top-level `function ` declaration.
      const declRe = new RegExp(`function\\s+${name}\\s*\\(([^)]*)\\)`);
      const declMatch = SRC.match(declRe);
      if (!declMatch) continue;
      const params = declMatch[1].split(',').map(p => p.trim()).filter(Boolean);
      if (!params.includes('url')) continue; // doesn't take url — skip

      const startIdx = declMatch.index + declMatch[0].length;
      const restOfFile = SRC.slice(startIdx);
      // Function body ends at the next "\n}\n\n" sequence or next "function "
      // declaration at column 0. The simpler heuristic: look for "\nfunction "
      // and slice up to it.
      const nextDeclIdx = restOfFile.search(/\nfunction\s+\w/);
      const body = nextDeclIdx >= 0 ? restOfFile.slice(0, nextDeclIdx) : restOfFile;

      // Use \burl\b to avoid matching "url" as part of another identifier.
      if (!/\burl\b/.test(body)) {
        dead.push(`${name} declares 'url' parameter but body never references it`);
      }
    }
    expect(dead).toEqual([]);
  });
});
