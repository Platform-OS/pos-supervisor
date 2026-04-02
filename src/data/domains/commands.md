[platformOS:commands] Commands use build/check/execute pattern: _build creates data, _check validates, _execute runs side effects.
MUST NOT execute if _check returns errors. Invoke via function tag: {% function result = 'lib/commands/my_cmd/execute', arg: value %}
Never use graphql tag to invoke a command — always use function tag.
→ domain_guide({ domain: "commands", section: "patterns" }) and domain_guide({ domain: "commands", section: "api" })
⚠️ MUST NOT create command files manually for CRUD resources. Run via bash:
  pos-cli generate run modules/core/generators/crud resource_name prop:type ... --include-views
  See schema domain header for full args/options reference. Do NOT use generators MCP tools.
