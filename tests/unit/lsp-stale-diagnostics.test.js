import { describe, it, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { PlatformOSLSPClient } from '../../src/core/lsp-client.js';

/**
 * Create a fake child process with controllable stdin/stdout/stderr.
 * Returns `send(msg)` to write JSON-RPC messages to stdout, and
 * `captureStdin()` to read messages sent by the client to stdin.
 */
function fakeLsp() {
  const stdin  = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const proc = Object.assign(new EventEmitter(), {
    stdin, stdout, stderr, pid: 99999, kill() {},
  });

  function send(msg) {
    const body = JSON.stringify(msg);
    stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }

  // Capture JSON-RPC messages written to stdin by the client
  const captured = [];
  const origWrite = stdin.write.bind(stdin);
  stdin.write = (data) => {
    const str = data.toString();
    const bodyMatch = str.match(/\r\n\r\n(.+)/s);
    if (bodyMatch) {
      try { captured.push(JSON.parse(bodyMatch[1])); } catch {}
    }
    return origWrite(data);
  };

  return { proc, send, captured };
}

function diagNotification(uri, diagnostics) {
  return {
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: { uri, diagnostics },
  };
}

function diag(line, code = 'TestCheck', message = 'test error') {
  return {
    range: { start: { line, character: 0 }, end: { line, character: 10 } },
    severity: 1, code, message,
  };
}

function hoverResponse(id, contents = 'docs') {
  return { jsonrpc: '2.0', id, result: { contents } };
}

function startClient() {
  const { proc, send, captured } = fakeLsp();
  const client = new PlatformOSLSPClient();
  client.start('pos-cli', ['lsp'], { spawnFn: () => proc, maxRestarts: 0 });
  return { client, proc, send, captured };
}

/** Helper: delay for given ms */
const delay = (ms) => new Promise(r => setTimeout(r, ms));

describe('awaitDiagnostics barrier + settle pattern', () => {

  it('sends a hover barrier request after syncDoc', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/test.liquid';

    const promise = client.awaitDiagnostics(uri, 'content\n', 2000);

    // Find the barrier hover request
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');
    expect(hoverReq).toBeDefined();
    expect(hoverReq.params.textDocument.uri).toBe(uri);

    // Respond to barrier, then send diagnostics
    send(hoverResponse(hoverReq.id));
    send(diagNotification(uri, [diag(0)]));

    const result = await promise;
    expect(result).toHaveLength(1);
    client.stop();
  });

  it('later diagnostics replace earlier ones via settle window', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/stale.liquid';

    const promise = client.awaitDiagnostics(uri, 'line1\nline2\n', 2000);
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');

    // Early diagnostics accepted, settle timer starts
    send(diagNotification(uri, [diag(9, 'EarlyCheck', 'from old analysis')]));

    send(hoverResponse(hoverReq.id));

    // Later diagnostics replace earlier ones, settle timer resets
    send(diagNotification(uri, [diag(0, 'FreshCheck', 'from new content')]));

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('FreshCheck');
    client.stop();
  });

  it('handles rapid sequence of diagnostics — settle picks latest', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/onechunk.liquid';

    const promise = client.awaitDiagnostics(uri, 'a\nb\n', 2000);
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');

    // All three messages arrive rapidly — settle picks the last batch
    send(diagNotification(uri, [diag(10, 'EarlyCheck')]));
    send(hoverResponse(hoverReq.id));
    send(diagNotification(uri, [diag(0, 'FreshCheck')]));

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('FreshCheck');
    client.stop();
  });

  it('accepts diagnostics that arrive before barrier hover responds', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/fast-lsp.liquid';

    const promise = client.awaitDiagnostics(uri, '{{ x | bad_filter }}\n', 2000);
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');

    // LSP emits diagnostics BEFORE responding to hover (fast analysis)
    send(diagNotification(uri, [diag(0, 'UnknownFilter', 'Unknown filter bad_filter')]));

    // Hover response arrives later
    send(hoverResponse(hoverReq.id));

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('UnknownFilter');
    client.stop();
  });

  it('resolves with empty array on timeout (no diagnostics after barrier)', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/timeout.liquid';

    const promise = client.awaitDiagnostics(uri, 'content\n', 400);
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');

    // Barrier passes but no diagnostics follow
    send(hoverResponse(hoverReq.id));

    const result = await promise;
    expect(result).toEqual([]);
    client.stop();
  });

  it('resolves with empty on timeout when barrier itself times out', async () => {
    const { client } = startClient();
    const uri = 'file:///test/app/no-barrier.liquid';

    // No hover response sent — barrier times out, then main timeout fires
    const result = await client.awaitDiagnostics(uri, 'content\n', 400);
    expect(result).toEqual([]);
    client.stop();
  });

  it('accepts diagnostics even when barrier hover never responds', async () => {
    const { client, send } = startClient();
    const uri = 'file:///test/app/late-barrier.liquid';

    const promise = client.awaitDiagnostics(uri, 'content\n', 5000);

    // Don't respond to barrier hover — diagnostics still accepted
    setTimeout(() => {
      send(diagNotification(uri, [diag(0, 'LateCheck')]));
    }, 100);

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('LateCheck');
    client.stop();
  });

  it('resolves with empty on crash during await', async () => {
    const { client, proc, send, captured } = startClient();
    const uri = 'file:///test/app/crash.liquid';

    const promise = client.awaitDiagnostics(uri, 'content\n', 5000);
    proc.emit('exit', 1, null);

    const result = await promise;
    expect(result).toEqual([]);
    client.stop();
  });

  it('accepts diagnostics when hover responds with error', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/hover-error.liquid';

    const promise = client.awaitDiagnostics(uri, 'content\n', 2000);
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');

    send({ jsonrpc: '2.0', id: hoverReq.id, error: { code: -32601, message: 'not supported' } });
    send(diagNotification(uri, [diag(0, 'FreshAfterError')]));

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('FreshAfterError');
    client.stop();
  });

  it('works correctly across multiple sequential calls to same URI', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/sequential.liquid';

    // First call
    const p1 = client.awaitDiagnostics(uri, 'v1\n', 2000);
    const hover1 = captured.find(m => m.method === 'textDocument/hover');
    send(hoverResponse(hover1.id));
    send(diagNotification(uri, [diag(0, 'V1Check')]));
    const r1 = await p1;
    expect(r1).toHaveLength(1);
    expect(r1[0].code).toBe('V1Check');

    // Second call — settle window picks the latest batch
    captured.length = 0;
    const p2 = client.awaitDiagnostics(uri, 'v2\n', 2000);
    const hover2 = captured.find(m => m.method === 'textDocument/hover');
    expect(hover2).toBeDefined();

    // Stale v1 diagnostics arrive first
    send(diagNotification(uri, [diag(0, 'StaleV1')]));

    send(hoverResponse(hover2.id));

    // Fresh v2 diagnostics replace stale ones via settle window
    send(diagNotification(uri, [diag(0, 'V2Check')]));

    const r2 = await p2;
    expect(r2).toHaveLength(1);
    expect(r2[0].code).toBe('V2Check');

    client.stop();
  });

  it('sequential calls to different URIs are independent', async () => {
    const { client, send, captured } = startClient();
    const uriA = 'file:///test/app/fileA.liquid';
    const uriB = 'file:///test/app/fileB.liquid';

    // Validate file A
    const pA = client.awaitDiagnostics(uriA, 'contentA\n', 2000);
    const hoverA = captured.find(m => m.method === 'textDocument/hover' && m.params.textDocument.uri === uriA);
    send(hoverResponse(hoverA.id));
    send(diagNotification(uriA, [diag(0, 'CheckA')]));
    const rA = await pA;
    expect(rA).toHaveLength(1);
    expect(rA[0].code).toBe('CheckA');

    // Validate file B — file A's results must not interfere
    captured.length = 0;
    const pB = client.awaitDiagnostics(uriB, 'contentB\n', 2000);
    const hoverB = captured.find(m => m.method === 'textDocument/hover' && m.params.textDocument.uri === uriB);
    send(hoverResponse(hoverB.id));
    send(diagNotification(uriB, [diag(0, 'CheckB')]));
    const rB = await pB;
    expect(rB).toHaveLength(1);
    expect(rB[0].code).toBe('CheckB');

    // Caches are independent
    expect(client.diags(uriA)[0].code).toBe('CheckA');
    expect(client.diags(uriB)[0].code).toBe('CheckB');

    client.stop();
  });

  it('stale diagnostics for file B do not resolve file A waiter', async () => {
    const { client, send, captured } = startClient();
    const uriA = 'file:///test/app/waitA.liquid';
    const uriB = 'file:///test/app/waitB.liquid';

    const pA = client.awaitDiagnostics(uriA, 'contentA\n', 2000);
    const hoverA = captured.find(m => m.method === 'textDocument/hover' && m.params.textDocument.uri === uriA);

    // Stale diagnostics for file B arrive — must NOT resolve file A's waiter
    send(diagNotification(uriB, [diag(5, 'WrongFile')]));

    // File A's barrier + fresh diagnostics
    send(hoverResponse(hoverA.id));
    send(diagNotification(uriA, [diag(0, 'CorrectA')]));

    const rA = await pA;
    expect(rA).toHaveLength(1);
    expect(rA[0].code).toBe('CorrectA');

    client.stop();
  });

  it('one file barrier timeout does not break another file', async () => {
    const { client, send, captured } = startClient();
    const uriSlow = 'file:///test/app/slow.liquid';
    const uriFast = 'file:///test/app/fast.liquid';

    // File slow — barrier will never get a response, short timeout
    const pSlow = client.awaitDiagnostics(uriSlow, 'slow\n', 500);

    // File fast — works normally
    captured.length = 0;
    const pFast = client.awaitDiagnostics(uriFast, 'fast\n', 2000);
    const hoverFast = captured.find(m => m.method === 'textDocument/hover' && m.params.textDocument.uri === uriFast);
    send(hoverResponse(hoverFast.id));
    send(diagNotification(uriFast, [diag(0, 'FastCheck')]));

    const rFast = await pFast;
    expect(rFast).toHaveLength(1);
    expect(rFast[0].code).toBe('FastCheck');

    // Slow file times out with empty
    const rSlow = await pSlow;
    expect(rSlow).toEqual([]);

    client.stop();
  });

  // ── Settle window tests ──

  it('settle window replaces stale post-barrier diags with fresh ones', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/settle.liquid';

    const promise = client.awaitDiagnostics(uri, 'new content\n', 3000);
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');

    // Barrier passes
    send(hoverResponse(hoverReq.id));

    // Stale diags from background analysis arrive AFTER barrier
    send(diagNotification(uri, [diag(0, 'BackgroundStale', 'from disk scan')]));

    // 50ms later: fresh diags from our didOpen analysis replace them
    await delay(50);
    send(diagNotification(uri, [diag(0, 'Fresh', 'from our content')]));

    const result = await promise;
    // Settle window waited 200ms after the last (fresh) notification
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('Fresh');
    client.stop();
  });

  it('settle window resolves with first diags if no replacement arrives', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/settle-single.liquid';

    const promise = client.awaitDiagnostics(uri, 'content\n', 3000);
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');

    // Barrier passes
    send(hoverResponse(hoverReq.id));

    // Only one set of diagnostics — settle resolves after 200ms quiet period
    send(diagNotification(uri, [diag(0, 'OnlyCheck')]));

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('OnlyCheck');
    client.stop();
  });

  it('settle window handles three rapid replacements', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/settle-triple.liquid';

    const promise = client.awaitDiagnostics(uri, 'content\n', 3000);
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');

    send(hoverResponse(hoverReq.id));

    // Three rapid diagnostic notifications — settle keeps resetting
    send(diagNotification(uri, [diag(0, 'First')]));
    await delay(20);
    send(diagNotification(uri, [diag(0, 'Second')]));
    await delay(20);
    send(diagNotification(uri, [diag(0, 'Third')]));

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('Third');
    client.stop();
  });

  it('timeout resolves with latest diags even during settle window', async () => {
    const { client, send, captured } = startClient();
    const uri = 'file:///test/app/settle-timeout.liquid';

    // Very short timeout — settle window won't complete before timeout
    const promise = client.awaitDiagnostics(uri, 'content\n', 350);
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');

    send(hoverResponse(hoverReq.id));
    send(diagNotification(uri, [diag(0, 'GotBeforeTimeout')]));

    // Keep sending replacements right before timeout, so settle (200ms) can't complete
    await delay(180);
    send(diagNotification(uri, [diag(0, 'LatestBeforeTimeout')]));

    const result = await promise;
    // Main timeout resolves with whatever latestDiags we have
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('LatestBeforeTimeout');
    client.stop();
  });

  it('crash during settle window resolves with empty', async () => {
    const { client, proc, send, captured } = startClient();
    const uri = 'file:///test/app/settle-crash.liquid';

    const promise = client.awaitDiagnostics(uri, 'content\n', 3000);
    const hoverReq = captured.find(m => m.method === 'textDocument/hover');

    send(hoverResponse(hoverReq.id));
    send(diagNotification(uri, [diag(0, 'BeforeCrash')]));

    // Crash during settle window — should resolve with empty
    await delay(50);
    proc.emit('exit', 1, null);

    const result = await promise;
    expect(result).toEqual([]);
    client.stop();
  });
});
