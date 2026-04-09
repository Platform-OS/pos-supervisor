import { createServer } from 'node:http';
import { getToolList, dispatchTool } from './tools.js';
import { listResources, readResource } from './resources.js';
import { ToolError } from './core/tool-error.js';
import { HTTP_MAX_BODY } from './core/constants.js';

/**
 * HTTP server — REST endpoints for tool discovery, execution, and resources.
 * MCP protocol (JSON-RPC over stdio) is handled by the SDK transport in server.js.
 */
export function startHttp(registry, { port, log, version }) {
  if (!port) return null;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;

    // ── GET routes ──────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok', server: 'pos-supervisor', version });
    }

    if (method === 'GET' && url.pathname === '/tools') {
      return sendJson(res, 200, { tools: getToolList(registry) });
    }

    if (method === 'GET' && url.pathname === '/resources') {
      return sendJson(res, 200, listResources());
    }

    // ── POST routes (need body parsing) ─────────────────────────────────
    if (method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      if (url.pathname === '/call') {
        return handleCall(registry, body, res);
      }

      if (url.pathname === '/resources/read') {
        return handleResourceRead(body, res);
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
    const status = err instanceof ToolError ? err.status
      : err.message.startsWith('Unknown tool') ? 404
      : 500;
    sendJson(res, status, { error: err.message });
  }
}

async function handleResourceRead(body, res) {
  const { uri } = body;
  if (!uri) {
    return sendJson(res, 400, { error: 'Missing uri field.' });
  }

  const result = await readResource(uri);
  if (result.error) {
    return sendJson(res, 404, { error: result.error.message });
  }
  sendJson(res, 200, result);
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
      if (size > HTTP_MAX_BODY) {
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
