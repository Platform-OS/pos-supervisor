# pos-supervisor

Domain-specific MCP server for platformOS projects. Gives LLM agents deep understanding of platformOS conventions, Liquid/GraphQL validation, project structure analysis, and code generation.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [pos-cli](https://github.com/mdyd-dev/pos-cli) installed and available in PATH
- A platformOS project directory

## Installation

```bash
git clone https://github.com/Platform-OS/pos-supervisor.git
cd pos-supervisor
bun install
npm link
```

`npm link` makes the `pos-supervisor` binary available globally in your PATH. The binary's shebang targets `bun`, so it runs under the Bun runtime regardless of caller.

## Upgrading from 0.7.x

Version 0.8.0 switches the runtime from Node.js to Bun. One step:

```bash
curl -fsSL https://bun.sh/install | bash
```

Then pull latest:

```bash
git pull
```

That's it. The existing `npm link` symlink and `node_modules` keep working — no re-install, no re-link, no config changes in Claude Code or OpenCode. Skip the Bun install if it's already on your PATH.

## Configuration

The server uses the current working directory as the platformOS project root. When launched by an AI coding tool from within your project, it works automatically with no extra configuration.

### Claude Code

#### per project

```bash
claude mcp add pos-supervisor -- pos-supervisor
```

#### global

```bash
claude mcp add pos-supervisor --scope user -- pos-supervisor
```

### OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "pos-supervisor": {
      "type": "local",
      "command": ["pos-supervisor"]
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
bun start
```

## Observability

```
# pos-supervisor dashboard
http://localhost:13900/dashboard
```
