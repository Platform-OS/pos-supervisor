import { describe, it, expect, afterEach } from 'bun:test';
import { createLogger } from '../../src/core/logger.js';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('createLogger', () => {
  const logDir = tmpdir();
  const logPath = join(logDir, 'pos-supervisor.jsonl');

  afterEach(() => {
    try { if (existsSync(logPath)) unlinkSync(logPath); } catch {}
  });

  it('creates logger with emit and log functions', () => {
    const logger = createLogger({ directory: logDir });
    expect(typeof logger.emit).toBe('function');
    expect(typeof logger.log).toBe('function');
    expect(typeof logger.close).toBe('function');
    logger.close();
  });

  it('writes JSONL entries via emit', async () => {
    const logger = createLogger({ directory: logDir, version: '0.1.0' });
    logger.emit('test_event', { key: 'value' });
    logger.close();

    // Wait for stream to flush
    await new Promise(r => setTimeout(r, 100));

    const content = readFileSync(logPath, 'utf8').trim();
    const entry = JSON.parse(content);

    expect(entry.event).toBe('test_event');
    expect(entry.key).toBe('value');
    expect(entry.v).toBe('0.1.0');
    expect(entry.ts).toBeDefined();
  });

  it('writes multiple entries as separate lines', async () => {
    const logger = createLogger({ directory: logDir });
    logger.emit('event_1', {});
    logger.emit('event_2', {});
    logger.close();

    await new Promise(r => setTimeout(r, 100));

    const content = readFileSync(logPath, 'utf8').trim();
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe('event_1');
    expect(JSON.parse(lines[1]).event).toBe('event_2');
  });
});
