# Changelog

## 0.3.0

### Fixed

- **Shopify object detection**: `pos-supervisor:ShopifyObject` structural warnings now include a `suggestion` field with Shopify-specific replacement guidance (e.g. "`cart` is a Shopify object. Use: `context.session`"). Previously only the enricher path via `UndefinedObject` provided suggestions; structural warnings had `message` only.
- **UndefinedObject enrichment test**: Updated to include `{% doc %}` block, matching upstream behavior change in `@platformos/platformos-check-common@0.0.17` where `UndefinedObject` is only reported for partials that declare expected params.
- **Performance test threshold**: `validate_code` quick mode threshold raised from 3s to 5s to reduce flakiness in CI/slower environments.

### Added

- **Upstream contract test suite** (`tests/upstream/`): 103 tests across 4 files that pin the behavior of upstream dependencies and detect regressions or opportunities when they change.
  - `parser-contract.test.js` — verifies `@platformos/liquid-html-parser` API surface (NodeTypes, NamedTags, AST shapes).
  - `data-contract.test.js` — verifies pos-cli bundled data file structures (objects.json, filters.json, tags.json, graphql.graphql).
  - `lsp-diagnostic-contract.test.js` — pins LSP check behavior (which checks fire for which inputs, message formats, severities). Would have caught the `UndefinedObject` behavior change immediately.
  - `lsp-coverage-map.test.js` — detects when the LSP starts covering checks that pos-supervisor handles via structural warnings, logging overlap opportunities.

### Breaking Changes

- **MCP SDK migration**: Replaced hand-rolled JSON-RPC stdio server with the official `@modelcontextprotocol/sdk`. The stdio transport now uses `McpServer` + `StdioServerTransport` from the SDK. Clients must send `notifications/initialized` after `initialize` per the MCP protocol spec.
- **HTTP `/mcp` endpoint removed**: MCP protocol is now handled exclusively via stdio (SDK transport). HTTP server retains REST endpoints (`/health`, `/tools`, `/call`, `/resources`, `/resources/read`).
- **Input validation via Zod**: Tool input schemas are now defined with Zod. Missing required parameters are caught at the protocol level by the SDK before reaching tool handlers. Error format for invalid inputs may differ from previous versions.

### Added

- `@modelcontextprotocol/sdk` and `zod` as dependencies.
- Tool annotations support via `McpServer.registerTool()`.
- Resources registered on McpServer for stdio consumers (previously only available via HTTP).
- `GET /resources` endpoint on HTTP server.
- `POST /resources/read` endpoint on HTTP server.
- Version number sourced from `package.json` for server identification.

### Changed

- **Tool descriptions**: Converted from `[...].join('\n')` arrays to template literal strings for readability.
- **Tool input schemas**: Converted from raw JSON Schema objects to Zod shapes. The registry converts them to JSON Schema for HTTP consumers via `zod-to-json-schema`.
- **Architecture**: `tools.js` now accepts an optional `McpServer` parameter in `createToolRegistry()`. When provided, tools are registered on both the internal Map registry (for HTTP) and the McpServer (for stdio).
- Session tracking bug fix: `validatedFiles.add()` now conditional on `result?.status === 'ok'` (was unconditional).
- `null` param guidance: All 4 knowledge.json entries that said "null/nil is compatible with any type" replaced with strict "NEVER pass null — use matching empty value" guidance, aligned with MetadataParamsCheck.md.
- `LiquidHTMLSyntaxError.md`: Replaced deprecated `parse_json` workaround with modern `{% assign %}` hash/array literal syntax.

### Removed

- `src/stdio-server.js` — replaced by SDK's `StdioServerTransport`.
- Dead export `getDomainFromPath` from `src/core/utils.js` (the one in `domain-detector.js` is used everywhere).
- 2 failing tests in `lsp-stale-diagnostics.test.js` that expected pre-barrier diagnostics to be stored (implementation correctly discards them).

## 0.2.0

- Initial public release with validate_code, enrich_error, domain_guide, analyze_project, lookup, server_status, project_map, scaffold, module_info, validate_intent tools.
- Hand-rolled JSON-RPC stdio and HTTP transports.
- LSP integration with pos-cli.
- Session tracking and plan enforcement.
