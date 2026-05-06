// Tier-3 phase 3 — high-volume bucket-B promotions:
//   • PartialCallArguments (28 emits in DEMO; 4 subrules)
//   • GraphQLVariablesCheck (3 emits; signature block via graph)
//   • UnusedDocParam       (11 emits; caller-aware confidence)
//
// Also covers the diagnostic-record extractors that feed these rules.

import { describe, test, expect, beforeEach } from 'bun:test';
import { clearRules, registerRules, runRules } from '../../../src/core/rules/engine.js';
import { extractParams } from '../../../src/core/diagnostic-record.js';
import { buildFactGraph } from '../../../src/core/project-fact-graph.js';

import { rules as PartialCallArgumentsRules } from '../../../src/core/rules/PartialCallArguments.js';
import { rules as GraphQLVariablesCheckRules } from '../../../src/core/rules/GraphQLVariablesCheck.js';
import { rules as UnusedDocParamRules } from '../../../src/core/rules/UnusedDocParam.js';

describe('extractParams — PartialCallArguments / GraphQLVariablesCheck / UnusedDocParam', () => {
  test('PartialCallArguments — required, function call', () => {
    expect(extractParams('PartialCallArguments', 'Required parameter key must be passed to function call'))
      .toEqual({ param_name: 'key', direction: 'required', call_kind: 'function', is_function_call: 'true' });
  });
  test('PartialCallArguments — required, render call', () => {
    expect(extractParams('PartialCallArguments', 'Required parameter success must be passed to render call'))
      .toEqual({ param_name: 'success', direction: 'required', call_kind: 'render', is_function_call: 'false' });
  });
  test('PartialCallArguments — unknown, render call', () => {
    expect(extractParams('PartialCallArguments', 'Unknown parameter params passed to render call'))
      .toEqual({ param_name: 'params', direction: 'unknown', call_kind: 'render', is_function_call: 'false' });
  });
  test('PartialCallArguments — extractor returns {} on unknown shape', () => {
    expect(extractParams('PartialCallArguments', 'something brand new')).toEqual({});
  });
  test('GraphQLVariablesCheck — required', () => {
    expect(extractParams('GraphQLVariablesCheck', 'Required parameter name must be passed to GraphQL call'))
      .toEqual({ param_name: 'name', direction: 'required', call_kind: 'graphql' });
  });
  test('GraphQLVariablesCheck — unknown', () => {
    expect(extractParams('GraphQLVariablesCheck', 'Unknown parameter foo passed to GraphQL call'))
      .toEqual({ param_name: 'foo', direction: 'unknown', call_kind: 'graphql' });
  });
  test('UnusedDocParam — extractor', () => {
    expect(extractParams('UnusedDocParam', "The parameter 'title' is defined but not used in this file."))
      .toEqual({ param_name: 'title' });
    expect(extractParams('UnusedDocParam', 'unparseable'))
      .toEqual({});
  });
});

describe('PartialCallArguments rule', () => {
  beforeEach(() => { clearRules(); registerRules(PartialCallArgumentsRules); });

  function run(message) {
    const params = extractParams('PartialCallArguments', message);
    return runRules({ check: 'PartialCallArguments', params, message }, {});
  }

  test('required + render → required_render with `success: success` example', () => {
    const r = run('Required parameter success must be passed to render call');
    expect(r.rule_id).toBe('PartialCallArguments.required_render');
    expect(r.hint_md).toContain('forward caller');
    expect(r.hint_md).toMatch(/render '[^']+', success: success/);
    expect(r.confidence).toBe(0.7);
    expect(r.see_also.args.domain).toBe('partials');
  });

  test('required + function → required_function with `function r = ...` example', () => {
    const r = run('Required parameter key must be passed to function call');
    expect(r.rule_id).toBe('PartialCallArguments.required_function');
    expect(r.hint_md).toMatch(/function r = '[^']+', key: key/);
    expect(r.see_also.args.domain).toBe('commands');
  });

  test('unknown + render → unknown_render with three-option (drop / declare / rename)', () => {
    const r = run('Unknown parameter params passed to render call');
    expect(r.rule_id).toBe('PartialCallArguments.unknown_render');
    expect(r.hint_md).toContain('Drop');
    expect(r.hint_md).toContain('Declare');
    expect(r.hint_md).toContain('Rename');
    expect(r.fixes[0].description).toMatch(/[Mm]odule-owned/);
  });

  test('unknown + function → unknown_function', () => {
    const r = run('Unknown parameter from passed to function call');
    expect(r.rule_id).toBe('PartialCallArguments.unknown_function');
  });

  test('cross-references the sibling Missing*Arguments check', () => {
    const r = run('Required parameter success must be passed to render call');
    expect(r.hint_md).toContain('MissingRenderPartialArguments');
  });

  test('default fallback when extractor produces no params', () => {
    const r = run('Some new diagnostic shape');
    expect(r.rule_id).toBe('PartialCallArguments.default');
    expect(r.confidence).toBeLessThanOrEqual(0.5);
  });
});

describe('GraphQLVariablesCheck rule', () => {
  beforeEach(() => { clearRules(); registerRules(GraphQLVariablesCheckRules); });

  // Minimal fixture: one page that calls a graphql operation with two
  // declared variables. Graph maps page path → graphql_calls; graphql
  // node carries the args list.
  const graph = buildFactGraph({
    pages: {
      'idx': {
        path: 'app/views/pages/contact.liquid',
        slug: 'contact',
        method: 'post',
        renders: [],
        function_calls: [],
        graphql_calls: [{ variable: 'r', queryName: 'contact_messages/create' }],
      },
    },
    partials: {}, commands: {}, queries: {},
    graphql: {
      'contact_messages/create': {
        operation: 'mutation',
        name: 'create',
        args: [{ name: 'name', type: 'String!' }, { name: 'email', type: 'String!' }],
        table: 'contact',
      },
    },
    schema: {}, layouts: {}, translations: {}, assets: [],
  });

  test('required → ships canonical examples + signature block from graph', () => {
    const r = runRules({
      check: 'GraphQLVariablesCheck',
      params: extractParams('GraphQLVariablesCheck', 'Required parameter name must be passed to GraphQL call'),
      message: 'Required parameter name must be passed to GraphQL call',
      file: 'app/views/pages/contact.liquid',
    }, { graph });
    expect(r.rule_id).toBe('GraphQLVariablesCheck.required');
    expect(r.hint_md).toContain('contact_messages/create');
    expect(r.hint_md).toContain('$name: String!');
    expect(r.hint_md).toContain('$email: String!');
    expect(r.fixes[0].description).toContain('app/graphql/contact_messages/create.graphql');
  });

  test('unknown → 3-option fix, with signature block when graph has the call', () => {
    const r = runRules({
      check: 'GraphQLVariablesCheck',
      params: extractParams('GraphQLVariablesCheck', 'Unknown parameter foo passed to GraphQL call'),
      message: 'Unknown parameter foo passed to GraphQL call',
      file: 'app/views/pages/contact.liquid',
    }, { graph });
    expect(r.rule_id).toBe('GraphQLVariablesCheck.unknown');
    expect(r.hint_md).toContain('Drop');
    expect(r.hint_md).toContain('Declare');
    expect(r.hint_md).toContain('Rename');
    expect(r.hint_md).toContain('contact_messages/create');
  });

  test('signature block omitted when caller file is unknown to graph', () => {
    const r = runRules({
      check: 'GraphQLVariablesCheck',
      params: extractParams('GraphQLVariablesCheck', 'Required parameter name must be passed to GraphQL call'),
      message: 'Required parameter name must be passed to GraphQL call',
      file: 'app/views/pages/orphan.liquid',
    }, { graph });
    expect(r.rule_id).toBe('GraphQLVariablesCheck.required');
    expect(r.hint_md).not.toContain('GraphQL operation(s) called');
  });

  test('default fallback', () => {
    const r = runRules({
      check: 'GraphQLVariablesCheck',
      params: extractParams('GraphQLVariablesCheck', 'something obscure'),
      message: 'something obscure',
    }, {});
    expect(r.rule_id).toBe('GraphQLVariablesCheck.default');
  });

  // Repro for the DEMO 2026-04-27 regression spiral. When the project
  // graph reports the file's graphql call with source_kind=liquid_multiline_truncated,
  // the parser_blind_spot sub-rule must fire BEFORE .required and steer the
  // agent at the syntactic root cause.
  describe('parser_blind_spot — multi-line truncation', () => {
    const truncatedGraph = buildFactGraph({
      pages: {},
      partials: {},
      commands: {
        'app/lib/commands/contacts/create.liquid': {
          path: 'app/lib/commands/contacts/create.liquid',
          renders: [],
          function_calls: [],
          graphql_calls: [{
            variable: 'result',
            queryName: 'contacts/create',
            args: [],
            source_kind: 'liquid_multiline_truncated',
          }],
        },
      },
      queries: {},
      graphql: {
        'contacts/create': {
          operation: 'mutation',
          name: 'create',
          args: [
            { name: 'name', type: 'String!' },
            { name: 'email', type: 'String!' },
          ],
          table: 'contact',
        },
      },
      schema: {}, layouts: {}, translations: {}, assets: [],
    });

    test('fires before .required when graph flags the call truncated', () => {
      const r = runRules({
        check: 'GraphQLVariablesCheck',
        params: extractParams('GraphQLVariablesCheck', 'Required parameter name must be passed to GraphQL call'),
        message: 'Required parameter name must be passed to GraphQL call',
        file: 'app/lib/commands/contacts/create.liquid',
      }, { graph: truncatedGraph });
      expect(r.rule_id).toBe('GraphQLVariablesCheck.parser_blind_spot');
      expect(r.hint_md).toContain('parser cannot see it');
      expect(r.hint_md).toContain('Fix the syntax');
      expect(r.hint_md).toContain('contacts/create');
      expect(r.confidence).toBe(0.95);
    });

    test('does NOT fire for direction=unknown — only required suffers from this blind spot', () => {
      const r = runRules({
        check: 'GraphQLVariablesCheck',
        params: extractParams('GraphQLVariablesCheck', 'Unknown parameter foo passed to GraphQL call'),
        message: 'Unknown parameter foo passed to GraphQL call',
        file: 'app/lib/commands/contacts/create.liquid',
      }, { graph: truncatedGraph });
      expect(r.rule_id).toBe('GraphQLVariablesCheck.unknown');
    });

    test('falls through to .required when the call is NOT truncated', () => {
      const okGraph = buildFactGraph({
        pages: {},
        partials: {},
        commands: {
          'app/lib/commands/contacts/create.liquid': {
            path: 'app/lib/commands/contacts/create.liquid',
            renders: [],
            function_calls: [],
            graphql_calls: [{
              variable: 'result',
              queryName: 'contacts/create',
              args: ['name', 'email'],
              source_kind: 'tag',
            }],
          },
        },
        queries: {},
        graphql: {
          'contacts/create': {
            operation: 'mutation', name: 'create',
            args: [{ name: 'name', type: 'String!' }, { name: 'email', type: 'String!' }],
            table: 'contact',
          },
        },
        schema: {}, layouts: {}, translations: {}, assets: [],
      });
      const r = runRules({
        check: 'GraphQLVariablesCheck',
        params: extractParams('GraphQLVariablesCheck', 'Required parameter name must be passed to GraphQL call'),
        message: 'Required parameter name must be passed to GraphQL call',
        file: 'app/lib/commands/contacts/create.liquid',
      }, { graph: okGraph });
      expect(r.rule_id).toBe('GraphQLVariablesCheck.required');
    });

    test('falls through to .required when the file is not in the graph', () => {
      const r = runRules({
        check: 'GraphQLVariablesCheck',
        params: extractParams('GraphQLVariablesCheck', 'Required parameter name must be passed to GraphQL call'),
        message: 'Required parameter name must be passed to GraphQL call',
        file: 'app/views/pages/orphan.liquid',
      }, { graph: truncatedGraph });
      expect(r.rule_id).toBe('GraphQLVariablesCheck.required');
    });

    test('safe when no graph is available (degrades to .required)', () => {
      const r = runRules({
        check: 'GraphQLVariablesCheck',
        params: extractParams('GraphQLVariablesCheck', 'Required parameter name must be passed to GraphQL call'),
        message: 'Required parameter name must be passed to GraphQL call',
        file: 'app/lib/commands/contacts/create.liquid',
      }, {});
      expect(r.rule_id).toBe('GraphQLVariablesCheck.required');
    });
  });
});

describe('UnusedDocParam rule', () => {
  beforeEach(() => { clearRules(); registerRules(UnusedDocParamRules); });

  test('lone partial (zero callers in graph) → safer to remove, higher confidence', () => {
    const graph = buildFactGraph({
      pages: {}, partials: {
        'shared/orphan': { path: 'app/views/partials/shared/orphan.liquid', params: ['title'], renders: [], function_calls: [], rendered_by: [] },
      },
      commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [],
    });
    const r = runRules({
      check: 'UnusedDocParam',
      params: extractParams('UnusedDocParam', "The parameter 'title' is defined but not used in this file."),
      message: "The parameter 'title' is defined but not used in this file.",
      file: 'app/views/partials/shared/orphan.liquid',
    }, { graph });
    expect(r.rule_id).toBe('UnusedDocParam.default');
    expect(r.confidence).toBe(0.8);
    expect(r.fixes[0].description).toMatch(/option B \(remove `@param title`[^)]*\) is safe/);
  });

  test('partial with callers → lower confidence, warns about contract change', () => {
    const graph = buildFactGraph({
      pages: {
        'idx': { path: 'app/views/pages/index.liquid', renders: ['shared/card'], render_calls: [{ partial: 'shared/card', args: ['title'] }], function_calls: [] },
      },
      partials: {
        'shared/card': { path: 'app/views/partials/shared/card.liquid', params: ['title'], renders: [], function_calls: [], rendered_by: [] },
      },
      commands: {}, queries: {}, graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [],
    });
    const r = runRules({
      check: 'UnusedDocParam',
      params: extractParams('UnusedDocParam', "The parameter 'title' is defined but not used in this file."),
      message: "The parameter 'title' is defined but not used in this file.",
      file: 'app/views/partials/shared/card.liquid',
    }, { graph });
    expect(r.rule_id).toBe('UnusedDocParam.default');
    expect(r.confidence).toBe(0.65);
    expect(r.hint_md).toContain('caller(s) reference this file');
    expect(r.fixes[0].description).toContain('caller(s) reference this file');
  });

  test('no graph / file → degraded but functional', () => {
    const r = runRules({
      check: 'UnusedDocParam',
      params: extractParams('UnusedDocParam', "The parameter 'foo' is defined but not used in this file."),
      message: "The parameter 'foo' is defined but not used in this file.",
    }, {});
    expect(r.rule_id).toBe('UnusedDocParam.default');
    expect(r.hint_md).toContain('Caller count unknown');
    expect(r.hint_md).toContain('platformos_references');
  });

  test('hint references the pipeline pre-suppression', () => {
    const r = runRules({
      check: 'UnusedDocParam',
      params: extractParams('UnusedDocParam', "The parameter 'foo' is defined but not used in this file."),
      message: "The parameter 'foo' is defined but not used in this file.",
    }, {});
    // The diagnosis emphasises that named-arg use in this file is already
    // suppressed upstream — surviving emits are real dead declarations.
    expect(r.hint_md).toContain('pipeline already suppresses');
  });
});
