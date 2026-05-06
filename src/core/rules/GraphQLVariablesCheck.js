/**
 * GraphQLVariablesCheck rules — `{% graphql result = 'op_name', $X: Y %}`
 * passed (or omitted) a variable that doesn't match the .graphql operation's
 * declared signature.
 *
 * Pre-rule the check landed as `.unmatched` (3 emits in DEMO, 100 %
 * resolution but 0 % adoption — the LSP message named the variable but
 * carried no actionable fix). The rule extracts variable + direction
 * (required vs unknown) from the message and, when the file has graphql
 * calls indexed by the project graph, surfaces the operation's full
 * variable signature so the agent can pick the right value type.
 *
 * Subrules:
 *   • GraphQLVariablesCheck.parser_blind_spot — call lives inside a
 *       `{% liquid %}` block with multi-line `,` continuation. Both
 *       liquid-html-parser and pos-cli's LSP truncate the call at the first
 *       newline-comma; LSP fires `.required` for every arg past it. The
 *       agent sees the args in source, our default `.required` hint says
 *       "add the arg" — agent enters a regression spiral. This sub-rule
 *       fires first when the project graph reports the file's graphql call
 *       with `source_kind === 'liquid_multiline_truncated'` and steers the
 *       agent at the syntactic root cause instead. (Reproduced in DEMO
 *       2026-04-27, 4 emits / 100 % regression.)
 *   • GraphQLVariablesCheck.required        — agent forgot a `$var` argument.
 *   • GraphQLVariablesCheck.unknown         — agent passed an undeclared `$var`.
 *   • GraphQLVariablesCheck.default         — extractor failed; bare hint.
 *
 * Fix policy: guidance-only; the deterministic edit needs the call's
 * argument list which the rule layer doesn't have.
 */

export const rules = [
  {
    id: 'GraphQLVariablesCheck.parser_blind_spot',
    check: 'GraphQLVariablesCheck',
    priority: 3,
    when: (diag, facts) => isParserBlindSpot(diag, facts),
    apply: (diag, facts) => buildParserBlindSpotHint(diag, facts),
  },
  {
    id: 'GraphQLVariablesCheck.required',
    check: 'GraphQLVariablesCheck',
    priority: 5,
    when: (diag) => diag.params?.direction === 'required',
    apply: (diag, facts) => buildRequiredHint(diag, facts),
  },
  {
    id: 'GraphQLVariablesCheck.unknown',
    check: 'GraphQLVariablesCheck',
    priority: 6,
    when: (diag) => diag.params?.direction === 'unknown',
    apply: (diag, facts) => buildUnknownHint(diag, facts),
  },
  {
    id: 'GraphQLVariablesCheck.default',
    check: 'GraphQLVariablesCheck',
    priority: 100,
    when: () => true,
    apply: (diag) => ({
      rule_id: 'GraphQLVariablesCheck.default',
      hint_md:
        `\`{% graphql %}\` variable mismatch. Open the called .graphql operation under \`app/graphql/\` ` +
        `and read the operation header — variables declared as \`$name: Type\` (no leading \`$\` is wrong). ` +
        `Required → add the argument to the tag (\`{% graphql r = 'op', name: value %}\`); Unknown → drop it.`,
      fixes: [{
        type: 'guidance',
        description:
          `Open the .graphql file's operation header to see the full \`$variable: Type\` signature, then ` +
          `pass each required variable as a named argument on the \`{% graphql %}\` tag.`,
      }],
      confidence: 0.5,
    }),
  },
];

/**
 * True when the diagnostic looks like the multi-line truncation false-flag:
 *   • LSP fired `direction: required` (it sees no args at all).
 *   • Project graph has a graphql call from this file whose extracted
 *     `source_kind === 'liquid_multiline_truncated'`.
 *
 * `source_kind` is populated by `liquid-parser.classifyGraphqlSourceKind`
 * during scan — see liquid-parser.js for the detection criterion. Falsy
 * graphs / unindexed files / unrelated source kinds all fall through to the
 * downstream `.required` rule, so this predicate is purely additive.
 */
function isParserBlindSpot(diag, facts) {
  if (diag?.params?.direction !== 'required') return false;
  const node = facts?.graph?.nodeByPath?.(diag?.file);
  const calls = node?.graphql_calls ?? [];
  return calls.some(c => c?.source_kind === 'liquid_multiline_truncated');
}

function buildParserBlindSpotHint(diag, facts) {
  const param = diag?.params?.param_name ?? '<var>';
  const sigBlock = signatureBlock(diag, facts);
  return {
    rule_id: 'GraphQLVariablesCheck.parser_blind_spot',
    hint_md:
      `\`{% graphql %}\` call appears to pass \`${param}\`, but the parser cannot see it. ` +
      `The call lives inside a \`{% liquid %}\` block written with multi-line \`,\` ` +
      `continuation — both pos-cli's check and the AST parser stop at the first newline-comma, ` +
      `so every named argument past it is silently dropped.\n\n` +
      `Do NOT keep adding the argument — it is already there in source. **Fix the syntax**:\n\n` +
      '```liquid\n' +
      `{% graphql result = '<op_name>', ${param}: ${param}, ... %}    # tag form, args on one line\n` +
      '```\n' +
      `or, if you must keep it inside \`{% liquid %}\`, put every named arg on the SAME line as ` +
      `\`graphql\`:\n\n` +
      '```liquid\n' +
      `{% liquid\n` +
      `  graphql result = '<op_name>', ${param}: ${param}, email: email, ...\n` +
      `%}\n` +
      '```' +
      sigBlock,
    fixes: [{
      type: 'guidance',
      description:
        `Convert the multi-line \`graphql\` call to a single-line form. Either move it out of ` +
        `\`{% liquid %}\` into \`{% graphql ... %}\` tag delimiters, or keep it inside the block ` +
        `but place every \`name: value\` argument on the same line as \`graphql\`. The arguments ` +
        `you wrote are correct — only the line breaks are dropping them.${diagFiles(diag, facts)}`,
    }],
    confidence: 0.95,
    see_also: {
      tool: 'domain_guide',
      args: { domain: 'graphql' },
      reason: 'Multi-line `{% graphql %}` continuation inside `{% liquid %}` is silently truncated. domain_guide(graphql) shows the canonical tag form.',
    },
  };
}

function buildRequiredHint(diag, facts) {
  const param = diag.params?.param_name ?? '<var>';
  const sigBlock = signatureBlock(diag, facts);
  return {
    rule_id: 'GraphQLVariablesCheck.required',
    hint_md:
      `\`{% graphql %}\` call is missing required variable \`${param}\`. The operation declares ` +
      `\`$${param}: <Type>\` in its header — every non-optional variable (no \`= default\`) MUST be passed ` +
      `at the call site.\n\n` +
      `Add to the tag:\n` +
      '```liquid\n' +
      `{% graphql result = '<op_name>', ${param}: ${param} %}    # forward caller scope\n` +
      `{% graphql result = '<op_name>', ${param}: \"value\" %}    # literal\n` +
      `{% graphql result = '<op_name>', ${param}: context.params.${param} %}  # request param\n` +
      '```' +
      sigBlock,
    fixes: [{
      type: 'guidance',
      description:
        `Add \`${param}: <value>\` to the \`{% graphql %}\` tag. The value must match the declared ` +
        `GraphQL type — pass a string for \`String!\`, an integer for \`Int!\`, an object literal for ` +
        `input types, etc.${diagFiles(diag, facts)}`,
    }],
    confidence: 0.75,
    see_also: {
      tool: 'domain_guide',
      args: { domain: 'graphql' },
      reason: 'GraphQL call variable mismatch. domain_guide(graphql) covers $variable signatures and value forwarding.',
    },
  };
}

function buildUnknownHint(diag, facts) {
  const param = diag.params?.param_name ?? '<var>';
  const sigBlock = signatureBlock(diag, facts);
  return {
    rule_id: 'GraphQLVariablesCheck.unknown',
    hint_md:
      `\`{% graphql %}\` call passes \`${param}\` but the operation does NOT declare \`$${param}\`. ` +
      `Undeclared variables are silently dropped at call time — this is dead data that may mask a typo.\n\n` +
      `Pick one fix:\n` +
      `  A) **Drop** \`${param}: ...\` from the \`{% graphql %}\` tag in this file.\n` +
      `  B) **Declare** \`$${param}: <Type>\` in the .graphql operation's variable list (and use it in ` +
      `the body — orphan declarations themselves trigger \`GraphQLCheck\`).\n` +
      `  C) **Rename** \`${param}\` to match an existing operation variable — common cause is a typo.` +
      sigBlock,
    fixes: [{
      type: 'guidance',
      description:
        `Pick: (A) drop \`${param}: <value>\` from the call, (B) add \`$${param}: <Type>\` to the .graphql ` +
        `operation header, or (C) rename \`${param}\` to a declared variable.${diagFiles(diag, facts)}`,
    }],
    confidence: 0.75,
    see_also: {
      tool: 'domain_guide',
      args: { domain: 'graphql' },
      reason: 'GraphQL call passes an undeclared variable. domain_guide(graphql) covers $variable signatures.',
    },
  };
}

/**
 * Build a markdown block listing the declared variables of every graphql
 * operation called from `diag.file`. Empty string when the file is not
 * indexed or has no graphql_calls.
 *
 * Uses the graph's `graphql_calls` (which carries `{ variable, queryName }`
 * per call) and the per-operation node's `args` list (parsed from the
 * `.graphql` file's `query Foo($x: String!) { ... }` header).
 */
function signatureBlock(diag, facts) {
  const sigs = collectSignatures(diag, facts);
  if (sigs.length === 0) return '';
  const list = sigs.map(s => {
    const args = s.args.length === 0
      ? '(no variables)'
      : s.args.map(a => `\`$${a.name}: ${a.type}\``).join(', ');
    return `  • \`${s.queryName}\` — ${args}`;
  }).join('\n');
  return `\n\nGraphQL operation(s) called from this file:\n${list}`;
}

function diagFiles(diag, facts) {
  const sigs = collectSignatures(diag, facts);
  if (sigs.length !== 1) return '';
  return ` Reference: \`app/graphql/${sigs[0].queryName}.graphql\`.`;
}

function collectSignatures(diag, facts) {
  const graph = facts?.graph;
  const filePath = diag?.file;
  if (!graph || !filePath) return [];
  const node = graph.nodeByPath(filePath);
  if (!node) return [];
  const calls = node.graphql_calls ?? [];
  const out = [];
  const seen = new Set();
  for (const call of calls) {
    const queryName = typeof call === 'string' ? call : call?.queryName;
    if (!queryName || seen.has(queryName)) continue;
    seen.add(queryName);
    const opNode = graph.nodeByKey('graphql', queryName);
    if (!opNode) continue;
    out.push({ queryName, args: opNode.args ?? [] });
  }
  return out;
}
