import { describe, it, expect, beforeEach } from 'bun:test';
import { registerRules, clearRules, runRules } from '../../src/core/rules/engine.js';
import { rules } from '../../src/core/rules/MetadataParamsCheck.js';
import { buildFactGraph } from '../../src/core/project-fact-graph.js';

function buildGraphWithPartials() {
  return buildFactGraph({
    pages: {}, commands: {}, queries: {},
    graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [],
    partials: {
      'shared/card': {
        path: 'app/views/partials/shared/card.liquid',
        params: [
          { name: 'title', required: true },
          { name: 'body', required: true },
          { name: 'class', required: false },
        ],
        renders: [],
        function_calls: [],
      },
      'layouts/header': {
        path: 'app/views/partials/layouts/header.liquid',
        params: [
          { name: 'logo_url', required: true },
        ],
        renders: [],
        function_calls: [],
      },
    },
  });
}

function buildMinimalGraph() {
  return buildFactGraph({
    pages: {}, partials: {}, commands: {}, queries: {},
    graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [],
  });
}

describe('MetadataParamsCheck rules', () => {
  beforeEach(() => {
    clearRules();
    registerRules(rules);
  });

  describe('module_contract (priority 10)', () => {
    it('matches module partial paths', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'MetadataParamsCheck',
        params: { is_function_call: 'false' },
        message: "Missing required parameter in 'modules/core/lib/helpers/format_date'",
        file: 'app/views/pages/index.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('MetadataParamsCheck.module_contract');
      expect(result.confidence).toBe(0.85);
      expect(result.see_also).toBeDefined();
      expect(result.see_also.tool).toBe('module_info');
      expect(result.see_also.args.name).toBe('core');
    });

    it('handles function call variant', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'MetadataParamsCheck',
        params: { is_function_call: 'true' },
        message: "Missing required parameter in function call 'modules/user/commands/create'",
        file: 'app/views/pages/signup.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('MetadataParamsCheck.module_contract');
      expect(result.hint_md).toContain('function');
    });
  });

  describe('doc_block_params (priority 20)', () => {
    it('shows declared params from fact graph', () => {
      const graph = buildGraphWithPartials();
      const diag = {
        check: 'MetadataParamsCheck',
        params: { is_function_call: 'false' },
        message: "Missing required parameter in 'shared/card'",
        file: 'app/views/pages/blog.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('MetadataParamsCheck.doc_block_params');
      expect(result.confidence).toBe(0.8);
      expect(result.hint_md).toContain('title');
      expect(result.hint_md).toContain('required');
      expect(result.hint_md).toContain('class');
      expect(result.hint_md).toContain('optional');
      expect(result.see_also.tool).toBe('domain_guide');
    });

    it('does not match when partial has no params', () => {
      const graph = buildFactGraph({
        pages: {}, commands: {}, queries: {},
        graphql: {}, schema: {}, layouts: {}, translations: {}, assets: [],
        partials: {
          'simple/block': {
            path: 'app/views/partials/simple/block.liquid',
            params: [],
            renders: [],
            function_calls: [],
          },
        },
      });
      const diag = {
        check: 'MetadataParamsCheck',
        params: { is_function_call: 'false' },
        message: "Missing required parameter in 'simple/block'",
        file: 'test.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('MetadataParamsCheck.generic');
    });
  });

  describe('generic (priority 100)', () => {
    it('matches any MetadataParamsCheck as fallback', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'MetadataParamsCheck',
        params: { is_function_call: 'false' },
        message: 'Some metadata params error',
        file: 'test.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.rule_id).toBe('MetadataParamsCheck.generic');
      expect(result.confidence).toBe(0.4);
      expect(result.hint_md).toContain('Render call');
    });

    it('uses function call wording when is_function_call', () => {
      const graph = buildMinimalGraph();
      const diag = {
        check: 'MetadataParamsCheck',
        params: { is_function_call: 'true' },
        message: 'Some metadata params error in function call',
        file: 'test.liquid',
      };
      const result = runRules(diag, { graph });
      expect(result).not.toBeNull();
      expect(result.hint_md).toContain('Function call');
    });
  });
});
