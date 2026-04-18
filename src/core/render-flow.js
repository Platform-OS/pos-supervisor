/**
 * Render flow analyzer — cross-file variable tracking through render chains.
 *
 * Pure query functions over ProjectFactGraph. No side effects.
 *
 * Used by:
 *   - UnusedAssign rules: suppress when variable is passed to a render call
 *   - MissingRenderPartialArguments rules: show full signatures, detect chain satisfaction
 */

/**
 * Check if a variable is passed as an argument value in any render call within a file.
 * Handles both `{% render 'partial', arg: variable %}` (arg name matches variable)
 * and variable references in render call argument values.
 */
export function isVariablePassedToRender(graph, filePath, varName) {
  const calls = graph.renderCallsFrom(filePath);
  for (const call of calls) {
    if (call.args.includes(varName)) return true;
  }
  return false;
}

/**
 * Check if a variable is passed to any function call in the file's content.
 * Function calls use `{% function result = 'path', arg: value %}` — the arg
 * names reference variables that are "used".
 */
export function isVariablePassedToFunction(graph, filePath, varName) {
  const node = graph.nodeByPath(filePath);
  if (!node?.function_calls) return false;
  for (const fc of node.function_calls) {
    if (fc.variable === varName) return true;
  }
  return false;
}

/**
 * Get all callers of a partial with the arguments they pass.
 */
export function callersWithArgs(graph, partialKey) {
  return graph.renderCallsTo(partialKey);
}

/**
 * Get the declared parameters of a partial from its {% doc %} block.
 */
export function getPartialParams(graph, partialKey) {
  return graph.partialSignature(partialKey) ?? [];
}

/**
 * Find which declared parameters a specific caller does NOT pass.
 */
export function missingArgsForCaller(graph, callerPath, partialKey) {
  const params = getPartialParams(graph, partialKey);
  if (params.length === 0) return [];

  const calls = graph.renderCallsFrom(callerPath);
  const call = calls.find(c => c.partial === partialKey);
  if (!call) return [...params];

  const passed = new Set(call.args);
  return params.filter(p => !passed.has(p));
}

/**
 * Check if a missing param on a callee is satisfied by the caller having
 * that param in its own signature (received from a grandparent).
 * In a chain Page → A → B, if B requires `x` and A doesn't pass it,
 * but A declares `x` as a param, A has it in scope and can forward it.
 */
export function isParamAvailableInCallerScope(graph, callerPath, paramName) {
  const callerNode = graph.nodeByPath(callerPath);
  if (!callerNode?.params) return false;
  return callerNode.params.includes(paramName);
}

/**
 * Build a complete render flow summary for a file: all outgoing render calls
 * with their args, the target partial's declared params, and missing args.
 */
export function renderFlowSummary(graph, filePath) {
  const calls = graph.renderCallsFrom(filePath);
  return calls.map(call => {
    const targetParams = getPartialParams(graph, call.partial);
    const passed = new Set(call.args);
    const missing = targetParams.filter(p => !passed.has(p));
    return {
      partial: call.partial,
      passed_args: call.args,
      declared_params: targetParams,
      missing_args: missing,
    };
  });
}
