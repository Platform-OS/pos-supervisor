import { spawn } from 'node:child_process';
import { LSP_DIAGNOSTICS_TIMEOUT_MS, LSP_BARRIER_TIMEOUT_MS, DIAGNOSTICS_SETTLE_MS } from './constants.js';

export class PlatformOSLSPClient {
  #proc       = null;
  #buf        = '';
  #stderrBuf  = '';
  #reqId      = 0;
  #pending    = new Map();
  #diagnostics = new Map();
  #diagWaiters = new Map();
  #openDocs   = new Map();
  #onRequest  = null;
  #onCrash    = null;
  #cmd        = 'pos-cli';
  #args       = ['lsp'];
  #spawnFn    = spawn;
  #rootUri    = null;
  #stopping   = false;
  #restartCount  = 0;
  #maxRestarts   = 3;
  #restartDelayMs = 1000;
  initialized = false;

  start(cmd = 'pos-cli', args = ['lsp'], { onRequest, onCrash, spawnFn = spawn, maxRestarts = 3, restartDelayMs = 1000 } = {}) {
    this.#cmd            = cmd;
    this.#args           = args;
    this.#spawnFn        = spawnFn;
    this.#onRequest      = onRequest ?? null;
    this.#onCrash        = onCrash   ?? null;
    this.#maxRestarts    = maxRestarts;
    this.#restartDelayMs = restartDelayMs;
    this.#attachProc(spawnFn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env }));
    return this;
  }

  #attachProc(proc) {
    this.#proc      = proc;
    this.#buf       = '';
    this.#stderrBuf = '';

    proc.stdout.on('data', (chunk) => {
      this.#buf += chunk.toString('utf8');
      this.#drain();
    });

    proc.stderr.on('data', (chunk) => {
      this.#stderrBuf += chunk.toString('utf8');
    });

    proc.on('error', () => {
      if (!this.#stopping && proc === this.#proc) this.#handleCrash(null, null);
    });

    proc.on('exit', (code, signal) => {
      if (proc === this.#proc) this.initialized = false;
      if (!this.#stopping && proc === this.#proc) this.#handleCrash(code, signal);
    });
  }

  #rejectPending(err) {
    for (const cb of this.#pending.values()) cb.reject(err);
    this.#pending.clear();
    // Resolve diagnostic waiters with empty on crash
    for (const [, waiter] of this.#diagWaiters) {
      clearTimeout(waiter.timer);
      if (waiter.settleTimer) clearTimeout(waiter.settleTimer);
      waiter.resolve([]);
    }
    this.#diagWaiters.clear();
  }

  #handleCrash(code, signal) {
    const stderr = this.#stderrBuf;
    this.#rejectPending(new Error('LSP process exited'));
    this.#onCrash?.({ code, signal, stderr, restartCount: this.#restartCount });
    this.#tryRestart();
  }

  async #tryRestart() {
    if (this.#stopping || this.#restartCount >= this.#maxRestarts) return;
    this.#restartCount++;

    await new Promise(r => setTimeout(r, this.#restartDelayMs));
    if (this.#stopping) return;

    this.#openDocs.clear();

    const newProc = this.#spawnFn(
      this.#cmd, this.#args,
      { stdio: ['pipe', 'pipe', 'pipe'], env: process.env }
    );
    this.#attachProc(newProc);

    try {
      await this.initialize(this.#rootUri);
    } catch {
      // initialize failed — next crash/exit will try again up to maxRestarts
    }
  }

  #drain() {
    while (true) {
      const sep = this.#buf.indexOf('\r\n\r\n');
      if (sep === -1) break;

      const hdr = this.#buf.slice(0, sep);
      const match = hdr.match(/Content-Length:\s*(\d+)/i);
      if (!match) { this.#buf = ''; break; }

      const len = Number(match[1]);
      const bodyStart = sep + 4;
      if (this.#buf.length < bodyStart + len) break;

      const body = this.#buf.slice(bodyStart, bodyStart + len);
      this.#buf = this.#buf.slice(bodyStart + len);

      try { this.#handle(JSON.parse(body)); } catch (e) {
        this.#onRequest?.({ method: 'lsp:message_parse', durationMs: 0, success: false, error: e.message });
      }
    }
  }

  #handle(msg) {
    if (msg.method === 'textDocument/publishDiagnostics') {
      const uri = msg.params.uri;
      const diags = msg.params.diagnostics ?? [];
      this.#diagnostics.set(uri, diags);
      const waiter = this.#diagWaiters.get(uri);
      if (waiter?.onDiag) {
        waiter.onDiag(diags);
      } else if (waiter) {
        this.#diagWaiters.delete(uri);
        clearTimeout(waiter.timer);
        waiter.resolve(diags);
      }
      return;
    }
    if (msg.id != null) {
      const cb = this.#pending.get(msg.id);
      if (cb) {
        this.#pending.delete(msg.id);
        msg.error ? cb.reject(new Error(msg.error.message)) : cb.resolve(msg.result);
      }
    }
  }

  #send(msg) {
    if (!this.#proc?.stdin?.writable) return;
    const body = JSON.stringify(msg);
    this.#proc.stdin.write(
      `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
    );
  }

  #req(method, params, ms = 8_000) {
    return new Promise((resolve, reject) => {
      const id = ++this.#reqId;
      this.#pending.set(id, { resolve, reject });
      this.#send({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => {
        if (this.#pending.delete(id))
          reject(new Error(`platformOS LSP timeout: ${method}`));
      }, ms);
    });
  }

  async #timedReq(label, method, params, ms) {
    const start = Date.now();
    let success = true;
    try {
      const result = await this.#req(method, params, ms);
      return result;
    } catch (e) {
      success = false;
      throw e;
    } finally {
      this.#onRequest?.({ method: label, durationMs: Date.now() - start, success });
    }
  }

  #notify(method, params) {
    this.#send({ jsonrpc: '2.0', method, params });
  }

  async initialize(rootUri, { version } = {}) {
    this.#rootUri = rootUri;
    await this.#req(
      'initialize',
      {
        processId: process.pid,
        clientInfo: { name: 'pos-supervisor', version: version ?? '0.0.0' },
        rootUri,
        capabilities: {
          textDocument: {
            publishDiagnostics: {},
            hover: { contentFormat: ['markdown', 'plaintext'] },
            completion: { completionItem: { snippetSupport: false } },
          },
          workspace: { workspaceFolders: true },
        },
        workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
        initializationOptions: {
          'platformosCheck.includeFilesFromDisk': true,
        },
      },
      15_000
    );
    this.#notify('initialized', {});
    this.initialized = true;
  }

  syncDoc(uri, text) {
    const langId = uri.endsWith('.graphql') ? 'graphql' : 'liquid';
    const prev = this.#openDocs.get(uri);
    if (prev != null) {
      const ver = prev + 1;
      this.#openDocs.set(uri, ver);
      this.#notify('textDocument/didChange', {
        textDocument: { uri, version: ver },
        contentChanges: [{ text }],
      });
    } else {
      this.#openDocs.set(uri, 1);
      this.#notify('textDocument/didOpen', {
        textDocument: { uri, languageId: langId, version: 1, text },
      });
    }
  }

  /**
   * Public wrapper for workspace/didChangeWatchedFiles notifications.
   *
   * LSP change types: 1=Created, 2=Changed, 3=Deleted. The pos-cli LSP may or
   * may not honor this method; sending it is cheap and it is the spec-correct
   * way to hint at out-of-band file changes from a filesystem watcher.
   */
  notifyDidChangeWatched(uri, type = 2) {
    this.#notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri, type }],
    });
  }

  diags(uri) {
    return this.#diagnostics.get(uri) ?? [];
  }

  /**
   * Sync document content and wait for fresh diagnostics.
   *
   * Uses a barrier request to guarantee freshness. The LSP processes stdin
   * messages sequentially, so after sending:
   *   1. didOpen/didChange (our content)
   * Sync document content and wait for fresh diagnostics.
   *
   * Sends a hover request as a synchronization fence — the LSP must process
   * didOpen/didChange before responding to hover, proving it received our
   * content. A settle window (500ms quiet period) then waits for the LAST
   * publishDiagnostics batch, accepting all arrivals regardless of barrier
   * timing. The LSP may emit valid diagnostics before the hover response
   * when analysis is fast, so no pre-barrier filtering is applied.
   */
  awaitDiagnostics(uri, text, timeoutMs = LSP_DIAGNOSTICS_TIMEOUT_MS) {
    this.syncDoc(uri, text);
    this.#diagnostics.delete(uri);

    // ── Barrier: hover request as sync fence (ensures LSP processes our content) ──
    const barrierId = ++this.#reqId;
    const barrierTimer = setTimeout(() => {
      this.#pending.delete(barrierId);
    }, Math.min(timeoutMs, LSP_BARRIER_TIMEOUT_MS));

    this.#pending.set(barrierId, {
      resolve: () => { clearTimeout(barrierTimer); },
      reject:  () => { clearTimeout(barrierTimer); },
    });
    this.#send({
      jsonrpc: '2.0', id: barrierId,
      method: 'textDocument/hover',
      params: { textDocument: { uri }, position: { line: 0, character: 0 } },
    });

    // ── Diagnostic waiter: settle window resolves with latest batch ──
    const SETTLE_MS = DIAGNOSTICS_SETTLE_MS;
    return new Promise((resolve) => {
      let latestDiags = null;
      let settleTimer = null;

      const finish = (diags) => {
        this.#diagWaiters.delete(uri);
        clearTimeout(mainTimer);
        if (settleTimer) clearTimeout(settleTimer);
        resolve(diags);
      };

      const mainTimer = setTimeout(() => {
        this.#diagWaiters.delete(uri);
        if (settleTimer) clearTimeout(settleTimer);
        resolve(latestDiags ?? []);
      }, timeoutMs);

      this.#diagWaiters.set(uri, {
        timer: mainTimer,
        settleTimer: null,
        onDiag: (diags) => {
          latestDiags = diags;
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(() => finish(latestDiags), SETTLE_MS);
          this.#diagWaiters.get(uri).settleTimer = settleTimer;
        },
        resolve: (diags) => finish(diags),
      });
    });
  }

  hover(uri, line, character) {
    return this.#timedReq('hover', 'textDocument/hover', {
      textDocument: { uri },
      position: { line, character },
    }, 30_000);
  }

  completions(uri, line, character) {
    return this.#timedReq('completions', 'textDocument/completion', {
      textDocument: { uri },
      position: { line, character },
    }, 30_000);
  }

  definition(uri, line, character) {
    return this.#timedReq('definition', 'textDocument/definition', {
      textDocument: { uri },
      position: { line, character },
    }, 30_000);
  }

  references(uri, includeIndirect = false) {
    return this.#timedReq('references', 'appGraph/references', { uri, includeIndirect }, 30_000);
  }

  dependencies(uri, includeIndirect = false) {
    return this.#timedReq('dependencies', 'appGraph/dependencies', { uri, includeIndirect }, 30_000);
  }

  stop() {
    this.#stopping = true;
    try {
      this.#notify('shutdown', null);
      this.#notify('exit', null);
    } catch {}
    this.#proc?.kill();
  }

  async restart() {
    this.#stopping = true;
    this.#rejectPending(new Error('LSP restarting'));
    try { this.#notify('shutdown', null); this.#notify('exit', null); } catch {}
    this.#proc?.kill();
    this.initialized = false;

    await new Promise(r => setTimeout(r, 50));

    this.#stopping = false;
    this.#restartCount = 0;
    this.#openDocs.clear();

    const newProc = this.#spawnFn(
      this.#cmd, this.#args,
      { stdio: ['pipe', 'pipe', 'pipe'], env: process.env }
    );
    this.#attachProc(newProc);
    await this.initialize(this.#rootUri);
  }
}

/**
 * Convert LSP diagnostic array to the pos-supervisor internal format.
 * Same shape as parseCheckResult in check-runner.js.
 */
export function normalizeLspDiagnostics(lspDiags, filePath) {
  const errors = [];
  const warnings = [];
  const infos = [];
  const checks = new Set();

  for (const d of lspDiags) {
    const check = typeof d.code === 'string' ? d.code
      : typeof d.code === 'number' ? String(d.code)
      : (d.source ?? 'LSP');
    const severity = d.severity === 1 ? 'error'
      : d.severity === 2 ? 'warning'
      : 'info';

    const diagnostic = {
      check,
      severity,
      message: d.message,
      line: d.range?.start?.line ?? 0,
      column: d.range?.start?.character ?? 0,
      endLine: d.range?.end?.line ?? null,
      endColumn: d.range?.end?.character ?? null,
      _filePath: filePath,
    };
    checks.add(check);

    if (severity === 'error') errors.push(diagnostic);
    else if (severity === 'warning') warnings.push(diagnostic);
    else infos.push(diagnostic);
  }

  return { errors, warnings, infos, checks };
}