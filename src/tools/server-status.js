import { VALID_DOMAINS } from '../core/domain-detector.js';
import { ruleScores } from '../core/case-base.js';
import { getEngineMode } from '../core/engine-mode.js';

export const serverStatusTool = {
  name: 'server_status',
  description: 'Check pos-supervisor server status: LSP readiness, loaded indexes, pos-cli availability, the current session_pending state written by validate_intent, and the list of domain_guide domains available in this project. MUST be called at session start — surfaces the development_guide tip that agents MUST follow before writing any code.',
  inputSchema: {},

  createHandler(ctx) {
    return async () => {
      const pending = ctx.session?.pending ?? null;
      let disabledRules = [];
      if (ctx.analyticsStore) {
        try {
          // Engine state snapshot: bypass any operator reporting baseline.
          // The disabled-rules list must reflect the case-base's full-history
          // verdict — same data the runtime uses for syncDisabledRules.
          // `since: null` is the explicit bypass; see case-base.ruleScores.
          disabledRules = ruleScores(ctx.analyticsStore, { minEmitted: 10, since: null })
            .filter(s => s.disabled)
            .map(s => ({ rule_id: s.rule_id, effectiveness: s.effectiveness, total_outcomes: s.total_outcomes }));
        } catch { /* non-fatal */ }
      }
      return {
        server: 'pos-supervisor',
        version: ctx.version,
        engine_mode: getEngineMode(),
        project_dir: ctx.directory,
        pos_cli: {
          found: ctx.posCliFound ?? false,
          check_cmd: ctx.checkCmd,
        },
        lsp: {
          initialized: ctx.lsp?.initialized ?? false,
        },
        indexes: {
          schema: ctx.schemaIndex?._loaded ?? false,
          objects: ctx.objectsIndex?._loaded ?? false,
          filters: ctx.filtersIndex?._loaded ?? false,
          tags: ctx.tagsIndex?._loaded ?? false,
        },
        data_dir: ctx.dataDir ?? null,

        // Discoverable list of every domain this server has guidance for.
        // Agents MUST call domain_guide(domain) for each relevant domain BEFORE
        // drafting code — the full list lives here so the agent can see what
        // exists without reading tool descriptions first.
        domain_guides: [...VALID_DOMAINS],

        // Session start instructions — the single non-negotiable prescription.
        // Having it in server_status means every session starts with the agent
        // seeing the mandatory workflow, not buried in a tool description.
        development_guide: {
          call: 'load_development_guide',
          must_call_at: 'session_start',
          contains: 'Section 0 mandatory workflow, MUST/MUST NOT rules, and full platform reference. Single source of truth for platformOS agent sessions.',
        },
        tip: 'MUST call load_development_guide and domain_guide(domain) for every domain you touch BEFORE writing code. Covers gotchas, patterns, and auth rules not in training data. Skipping these is the #1 cause of broken platformOS code.',

        disabled_rules: disabledRules,

        session_pending: pending ? {
          files:        [...pending.files],
          translations: [...pending.translations],
          pages:        [...pending.pages],
          plan_id:      pending.planId,
          validated_at: pending.validatedAt,
        } : null,
      };
    };
  },
};
