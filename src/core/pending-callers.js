/**
 * Pending-aware caller filtering.
 *
 * AddedParam and NewPartialParams warnings list "existing files that already
 * render this partial without passing the new @param(s)". When a multi-file
 * creation plan is in flight, some of those callers may themselves be being
 * rewritten in the same plan — the agent will update them to pass the new
 * parameter. We partition the caller list into pending vs. remaining so the
 * warning only mentions callers that need the agent's separate attention.
 *
 * Path comparison is forgiving: pendingFiles entries may arrive as either
 * relative project paths (e.g. `app/views/pages/posts/index.html.liquid`)
 * or as the short form matching what the project map stores. We match on
 * exact string equality and on suffix equality in both directions.
 */

/**
 * Partition a caller list into {pending, remaining} against a pending-files set.
 *
 * @param {string[]} callers — caller paths as recorded in project_map
 * @param {string[]} pendingFiles — file paths being created/rewritten in the plan
 * @returns {{ pending: string[], remaining: string[] }}
 */
export function partitionCallersByPending(callers, pendingFiles) {
  if (!Array.isArray(callers) || callers.length === 0) {
    return { pending: [], remaining: [] };
  }
  if (!Array.isArray(pendingFiles) || pendingFiles.length === 0) {
    return { pending: [], remaining: [...callers] };
  }
  const pendingSet = new Set(pendingFiles);
  const pending = [];
  const remaining = [];
  for (const caller of callers) {
    if (isPending(caller, pendingSet, pendingFiles)) pending.push(caller);
    else remaining.push(caller);
  }
  return { pending, remaining };
}

function isPending(caller, pendingSet, pendingList) {
  if (pendingSet.has(caller)) return true;
  // Suffix match both ways to handle path-root mismatches between transports.
  for (const p of pendingList) {
    if (caller.endsWith(p) || p.endsWith(caller)) return true;
  }
  return false;
}
