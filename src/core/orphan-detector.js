/**
 * Orphan detection — single source of truth for "is this file referenced?".
 *
 * Before Phase 1.7 three separate codepaths encoded this logic with subtle
 * differences:
 *
 *   1. `analyze-project.js` checkIntegrity → iterated `projectMap.partials`
 *       and emitted `orphan_partial` issues whenever `rendered_by.length === 0`.
 *   2. `dependency-graph.js` `detectOrphanedFiles` → iterated the graph and
 *       applied entry-point exemptions (pages, subphases, graphql).
 *   3. `intent-validator.js` P5 → checked one partial at a time, combining
 *       project-state evidence with plan-local `referencedPartials`.
 *
 * They disagreed on whether pending plan references count (#3 yes, #1/#2 no)
 * which produced duplicate-looking but differently-scoped warnings.
 *
 * This module consolidates the predicates. Every consumer calls the helpers
 * below so the "is X orphaned?" question has exactly one answer per input.
 */

/**
 * Whether a partial has at least one renderer recorded in the project map.
 * Does not consider plan state — use `isOrphanPartial` for that.
 *
 * @param {string} partialName — scanner-canonical name (e.g. 'blog_posts/form')
 * @param {object} projectMap
 * @returns {boolean}
 */
export function isPartialRendered(partialName, projectMap) {
  const partial = projectMap?.partials?.[partialName];
  if (!partial) return false;
  return (partial.rendered_by ?? []).length > 0;
}

/**
 * Predicate: is the partial orphaned (nothing renders it) when considering
 * both the existing project and an in-flight plan's references?
 *
 * Use for:
 *   - validate_intent P5 (new partial about to be created)
 *   - analyze_project integrity (existing partials without renderers)
 *   - dependency-graph orphaned-file detection (partial-class files)
 *
 * A partial is NOT orphaned when any of the following is true:
 *   - any file in project_map renders it
 *   - a change in the pending plan renders it (planReferencedPartials)
 *   - a file the scaffold is about to create renders it (pendingFiles — we
 *     cannot inspect their contents here, but the plan-references set is
 *     expected to already encode that)
 *
 * @param {string} partialName
 * @param {object} projectMap
 * @param {object} [opts]
 * @param {Set<string>} [opts.planReferencedPartials] — names the plan renders
 * @returns {boolean}
 */
export function isOrphanPartial(partialName, projectMap, { planReferencedPartials } = {}) {
  if (planReferencedPartials?.has?.(partialName)) return false;
  return !isPartialRendered(partialName, projectMap);
}

/**
 * Return every partial in the project map that nothing renders.
 * Shape mirrors the `orphan_partial` integrity check shape so consumers can
 * map directly without reshuffling fields.
 *
 * @param {object} projectMap
 * @param {object} [opts]
 * @param {Set<string>} [opts.planReferencedPartials]
 * @returns {Array<{ name: string, path: string }>}
 */
export function findOrphanPartials(projectMap, { planReferencedPartials } = {}) {
  const orphans = [];
  for (const [name, partial] of Object.entries(projectMap?.partials ?? {})) {
    if (isOrphanPartial(name, projectMap, { planReferencedPartials })) {
      orphans.push({
        name,
        path: partial?.path ?? `app/views/partials/${name}.liquid`,
      });
    }
  }
  return orphans;
}

/**
 * Subphase command/query files live under /build/, /check/, /execute/ and are
 * called by convention at runtime — parent command files rarely wire them
 * explicitly, so static analysis always marks them orphaned. They must never
 * be flagged as orphaned.
 */
export function isSubphaseFile(path) {
  return /\/build(\/|\.liquid$)|\/check(\/|\.liquid$)|\/execute(\/|\.liquid$)/.test(path);
}
