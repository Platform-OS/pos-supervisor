# pos-supervisor

Domain-specific MCP server for platformOS projects. Gives LLM agents deep understanding of platformOS conventions, Liquid/GraphQL validation, project structure analysis, and code generation.

## Prerequisites

- Node.js >= 18
- [pos-cli](https://github.com/mdyd-dev/pos-cli) installed and available in PATH
- A platformOS project directory

## Installation

```bash
git clone https://github.com/Platform-OS/pos-supervisor.git
cd pos-supervisor
npm install
```

## Configuration

The server needs to know your platformOS project directory. Set it via the `POS_SUPERVISOR_PROJECT_DIR` environment variable, or it defaults to the current working directory.

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "pos-supervisor": {
      "command": "node",
      "args": ["/path/to/pos-supervisor/bin/pos-supervisor.js"],
      "env": {
        "POS_SUPERVISOR_PROJECT_DIR": "/path/to/your/platformos-project"
      }
    }
  }
}
```

Or use the CLI:

```bash
claude mcp add pos-supervisor \
  -e POS_SUPERVISOR_PROJECT_DIR=/path/to/your/platformos-project \
  -- node /path/to/pos-supervisor/bin/pos-supervisor.js
```

### OpenCode

Add to your `opencode.json`:

```json
{
  "mcp": {
    "pos-supervisor": {
      "command": "node",
      "args": ["/path/to/pos-supervisor/bin/pos-supervisor.js"],
      "env": {
        "POS_SUPERVISOR_PROJECT_DIR": "/path/to/your/platformos-project"
      }
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `validate_code` | Validate Liquid/GraphQL before writing. Returns diagnostics, fix hints, LSP intelligence, and structural analysis. |
| `validate_intent` | Validate a plan before any file is drafted. Catches architectural errors early. |
| `enrich_error` | Deep analysis of a specific linter error using LSP hover, completions, and references. |
| `domain_guide` | Get domain-specific guidance (gotchas, patterns, API reference) for pages, partials, graphql, translations, etc. |
| `analyze_project` | Cross-file project health: per-file diagnostics, dependency graph, broken references, dead code. |
| `project_map` | Structured JSON index: schemas, GraphQL operations, commands, queries, pages, partials with reverse-index. |
| `lookup` | Direct LSP access at a specific file position: hover docs, completions, definitions, references. |
| `scaffold` | Generate production-quality platformOS file sets for new features. |
| `module_info` | Reference for platformOS modules: version, API surface, schemas, usage patterns, gotchas. |
| `server_status` | Check server health: LSP readiness, loaded indexes, pos-cli availability. |

## Development

```bash
# Run tests
bun test tests/

# Start server directly
npm start
```
