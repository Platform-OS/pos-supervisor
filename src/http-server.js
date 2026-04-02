import { createServer } from 'node:http';
import { getToolList, dispatchTool } from './tools.js';
import { listResources, readResource } from './resources.js';

const MAX_BODY = 2 * 1024 * 1024; // 2 MB

/**
 * MCP HTTP server — built on node:http (zero dependencies).
 * Provides REST endpoints for tool discovery and execution.
 */
export function startHttp(registry, { port, log }) {
  if (!port) return null;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;

    // ── GET routes ──────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok', server: 'pos-supervisor', version: '0.2.0' });
    }

    if (method === 'GET' && url.pathname === '/tools') {
      return sendJson(res, 200, { tools: getToolList(registry) });
    }

    // ── POST routes (need body parsing) ─────────────────────────────────
    if (method === 'POST' && (url.pathname === '/call' || url.pathname === '/mcp')) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      if (url.pathname === '/call') {
        return handleCall(registry, body, res);
      }
      if (url.pathname === '/mcp') {
        return handleMcp(registry, body, res);
      }
    }

    // ── Fallback ────────────────────────────────────────────────────────
    sendJson(res, 404, { error: 'Not found' });
  });

  server.listen(port, () => {
    log?.(`HTTP server listening on http://localhost:${port}`);
  });

  return server;
}

// ── Route handlers ────────────────────────────────────────────────────────

async function handleCall(registry, body, res) {
  const { tool, name, params } = body;
  const toolName = tool || name;
  if (!toolName) {
    return sendJson(res, 400, { error: 'Missing tool name. Provide "tool" or "name" field.' });
  }

  try {
    const result = await dispatchTool(registry, toolName, params ?? {});
    sendJson(res, 200, { result });
  } catch (err) {
    const status = err.message.startsWith('Unknown tool') ? 404 : 500;
    sendJson(res, status, { error: err.message });
  }
}

async function handleMcp(registry, body, res) {
  const { id, method, params } = body;

  try {
    switch (method) {
      case 'initialize':
        return sendJson(res, 200, {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'pos-supervisor', version: '0.2.0' },
            capabilities: { tools: {}, resources: {} },
          },
        });

      case 'tools/list':
        return sendJson(res, 200, {
          jsonrpc: '2.0', id,
          result: { tools: getToolList(registry) },
        });

      case 'tools/call': {
        const { name: toolName, arguments: args } = params ?? {};
        const result = await dispatchTool(registry, toolName, args);
        return sendJson(res, 200, {
          jsonrpc: '2.0', id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        });
      }

      case 'resources/list':
        return sendJson(res, 200, { jsonrpc: '2.0', id, result: listResources() });

      case 'resources/read': {
        const rResult = await readResource(params?.uri);
        if (rResult.error) {
          return sendJson(res, 200, { jsonrpc: '2.0', id, error: rResult.error });
        }
        return sendJson(res, 200, { jsonrpc: '2.0', id, result: rResult });
      }

      default:
        return sendJson(res, 200, {
          jsonrpc: '2.0', id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  } catch (err) {
    sendJson(res, 200, {
      jsonrpc: '2.0', id,
      error: { code: -32603, message: err.message },
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error('Request body too large (max 2 MB)'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}
