/**
 * NonGetRenderingPage rule — attribution + hint for pages whose method is
 * non-GET but whose body renders HTML. Emitted by structural-warnings.js;
 * this module gives the diagnostic a stable rule_id so it lands in Rule
 * Performance instead of `.unmatched`.
 *
 * The structural warning already produces a detailed message; the rule's
 * hint_md is intentionally shorter and action-oriented (decision tree).
 * No fix is proposed — the right answer depends on intent (landing page
 * vs API endpoint) and guessing would do more harm than good.
 */

export const rules = [
  {
    id: 'NonGetRenderingPage.default',
    check: 'pos-supervisor:NonGetRenderingPage',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'NonGetRenderingPage.default',
      hint_md: 'Page will 404 on browser navigation because `method: post` only responds to POST. Decide: **landing page?** remove `method` (defaults to `get`) and have the form POST to a command handler. **API endpoint?** keep `method: post` but move the slug under `/api/…` and return JSON (not HTML). See the `NonGetRenderingPage` knowledge entry for full examples.',
      fixes: [],
      confidence: 0.9,
    }),
  },
];
