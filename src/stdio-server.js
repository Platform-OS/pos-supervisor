import { createInterface } from 'node:readline';
import { getToolList, dispatchTool } from './tools.js';
import { listResources, readResource } from './resources.js';

/**
 * MCP stdio server — JSON-RPC 2.0 over stdin/stdout.
 * Follows the same protocol pattern as pos-cli/mcp-min.
 */
export function startStdio(registry, { log }) {
  const rl = createInterface({ input: process.stdin, terminal: false });
  let pendingOps = 0;
  let stdinClosed = false;

  function send(msg) {
    try {
      process.stdout.write(JSON.stringify(msg) + '\n');
    } catch {
      // stdout may be closed
    }
  }

  function respond(id, result) {
    send({ jsonrpc: '2.0', id, result });
  }

  function respondError(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  function maybeExit() {
    if (stdinClosed && pendingOps === 0) {
      log?.('All requests complete — shutting down');
      process.exit(0);
    }
  }

  rl.on('line', async (line) => {
    if (!line.trim()) return;

    let msg;
    try {
      msg = JSON.parse(line.trim());
    } catch {
      return;
    }

    const { id, method, params } = msg;

    // Notifications (no id) — acknowledge silently
    if (id == null) return;

    pendingOps++;
    try {
      switch (method) {
        case 'initialize':
          respond(id, {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'pos-supervisor', version: '0.2.0' },
            capabilities: { tools: {}, resources: {} },
          });
          log?.('MCP initialized (stdio)');
          break;

        case 'notifications/initialized':
          respond(id, {});
          break;

        case 'tools/list':
          respond(id, { tools: getToolList(registry) });
          break;

        case 'resources/list':
          respond(id, listResources());
          break;

        case 'resources/read': {
          const result = await readResource(params?.uri);
          if (result.error) {
            respondError(id, result.error.code, result.error.message);
          } else {
            respond(id, result);
          }
          break;
        }

        case 'tools/call': {
          const { name, arguments: args } = params ?? {};
          try {
            const result = await dispatchTool(registry, name, args);
            respond(id, {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2),
              }],
            });
          } catch (err) {
            respond(id, {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: err.message }),
              }],
              isError: true,
            });
          }
          break;
        }

        default:
          respondError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      respondError(id, -32603, err.message);
    } finally {
      pendingOps--;
      maybeExit();
    }
  });

  // Wait for pending ops before exiting on stdin close
  rl.on('close', () => {
    log?.('stdin closed');
    stdinClosed = true;
    maybeExit();
  });

  log?.('Stdio server ready');
}
