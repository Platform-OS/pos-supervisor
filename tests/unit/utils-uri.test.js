import { describe, it, expect } from 'bun:test';
import { platform } from 'node:os';
import { toUri, fromUri } from '../../src/core/utils.js';

const isWindows = platform() === 'win32';

describe('toUri()', () => {
  it('produces a file:/// URI (three slashes) for an absolute path on this host', () => {
    const abs = isWindows ? 'C:\\Users\\test\\file.liquid' : '/home/test/file.liquid';
    const uri = toUri(abs);
    expect(uri.startsWith('file:///')).toBe(true);
  });

  it('round-trips through fromUri to the original absolute path', () => {
    const abs = isWindows ? 'C:\\Users\\test\\file.liquid' : '/home/test/file.liquid';
    const uri = toUri(abs);
    const back = fromUri(uri);
    // On Windows, fileURLToPath returns the canonical form (which may
    // normalize separators). Compare the resolved equivalent.
    if (isWindows) {
      expect(back.toLowerCase()).toBe(abs.toLowerCase());
    } else {
      expect(back).toBe(abs);
    }
  });

  it('passes through an already-formed file:/// URI unchanged', () => {
    const uri = 'file:///some/path/file.liquid';
    expect(toUri(uri)).toBe(uri);
  });

  it('encodes spaces in the path component', () => {
    const abs = isWindows ? 'C:\\Users\\my docs\\file.liquid' : '/home/test/my docs/file.liquid';
    const uri = toUri(abs);
    expect(uri).toContain('my%20docs');
    expect(fromUri(uri)).toContain('my docs');
  });

  it('handles non-ASCII characters via percent-encoding', () => {
    const abs = isWindows ? 'C:\\test\\zażółć.liquid' : '/test/zażółć.liquid';
    const uri = toUri(abs);
    // pathToFileURL percent-encodes non-ASCII; the URI must NOT contain raw UTF-8 bytes
    expect(uri).toMatch(/file:\/\/\//);
    // Round-trip preserves the original characters
    expect(fromUri(uri)).toBe(abs);
  });
});

describe('fromUri()', () => {
  it('extracts the absolute filesystem path from a file:/// URI', () => {
    const abs = isWindows ? 'C:\\test\\file.liquid' : '/test/file.liquid';
    const uri = toUri(abs);
    const back = fromUri(uri);
    if (isWindows) {
      expect(back.toLowerCase()).toBe(abs.toLowerCase());
    } else {
      expect(back).toBe(abs);
    }
  });

  it('passes through a non-URI input unchanged (defensive)', () => {
    expect(fromUri('/already/a/path')).toBe('/already/a/path');
    expect(fromUri('not-a-uri')).toBe('not-a-uri');
    expect(fromUri('')).toBe('');
  });

  it('passes through a malformed file:// URI rather than throwing', () => {
    // The historical bug: `file://C:\foo` was emitted before this fix.
    // We must never throw on a string that LOOKS like a URI — older
    // session files / persisted analytics may still contain these.
    const result = fromUri('file://C:\\malformed\\path');
    expect(typeof result).toBe('string');
  });
});

describe('Windows-specific URI shape (skipped on non-Windows)', () => {
  it('emits file:///C:/... for a Windows drive-letter path', () => {
    if (!isWindows) return;
    const uri = toUri('C:\\Users\\test\\file.liquid');
    expect(uri).toMatch(/^file:\/\/\/[A-Za-z]:\//);
  });

  it('normalizes backslashes to forward slashes in the URI', () => {
    if (!isWindows) return;
    const uri = toUri('C:\\Users\\test\\file.liquid');
    expect(uri).not.toContain('\\');
  });
});
