/**
 * Structured error for tool handlers.
 *
 * Throw this instead of returning { error: 'message' } so that both transports
 * (HTTP and MCP stdio) handle errors consistently:
 *   - HTTP: sends { error: message } with the appropriate status code
 *   - MCP:  sends { content: [{ type: 'text', text }], isError: true }
 *
 * Status codes:
 *   400 — input validation (bad params from caller)
 *   404 — resource not found (file, tool, index)
 *   503 — dependency unavailable (LSP not ready)
 */
export class ToolError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = 'ToolError';
    this.status = status;
  }
}
