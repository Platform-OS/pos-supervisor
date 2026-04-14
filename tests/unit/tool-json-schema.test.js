/**
 * Regression: every registered tool advertises its parameters in the HTTP
 * /tools response.
 *
 * We previously used `zod-to-json-schema@3.x` to convert Zod shapes for the
 * HTTP transport. That package silently returns `{}` for Zod v4 schemas,
 * which erased every tool's inputSchema and made clients blind to required
 * parameters (the scaffold tool's `properties` field, validate_code's
 * `file_path`, etc.). Clients that discover tools via HTTP then dropped
 * parameters they couldn't see, and the server rejected the resulting calls.
 *
 * The fix was switching to Zod v4's native `z.toJSONSchema`. This test pins
 * the contract so any future regression surfaces immediately.
 */

import { describe, it, expect } from 'bun:test';
import { createToolRegistry, getToolList } from '../../src/tools.js';

function makeCtx() {
  return {
    directory: process.cwd(),
    checkCmd: 'pos-cli',
    checkArgs: ['check'],
    log: () => {},
    emit: () => {},
    session: { pending: { files: new Set(), pages: new Set(), translations: new Set() }, fileHistory: new Map() },
  };
}

describe('tool JSON-schema serialization', () => {
  const registry = createToolRegistry(makeCtx());
  const tools = getToolList(registry);

  it('every tool exposes a non-empty JSON schema', () => {
    for (const t of tools) {
      expect(t.inputSchema).toBeTruthy();
      expect(t.inputSchema.type).toBe('object');
      // properties may be {} only if the tool truly has no parameters
      expect(t.inputSchema).toHaveProperty('properties');
    }
  });

  it('scaffold declares a "properties" parameter of array type', () => {
    const scaffold = tools.find(t => t.name === 'scaffold');
    expect(scaffold).toBeTruthy();
    expect(scaffold.inputSchema.properties).toHaveProperty('properties');
    expect(scaffold.inputSchema.properties.properties.type).toBe('array');
    // Required top-level params are type + name (properties is optional).
    expect(scaffold.inputSchema.required).toEqual(expect.arrayContaining(['type', 'name']));
  });

  it('scaffold\'s nested property items describe name/type/role', () => {
    const scaffold = tools.find(t => t.name === 'scaffold');
    const itemSchema = scaffold.inputSchema.properties.properties.items;
    expect(itemSchema.type).toBe('object');
    expect(itemSchema.properties).toHaveProperty('name');
    expect(itemSchema.properties).toHaveProperty('type');
    expect(itemSchema.properties).toHaveProperty('role');
    expect(itemSchema.required).toEqual(expect.arrayContaining(['name', 'type']));
  });

  it('validate_code surfaces file_path as required', () => {
    const vc = tools.find(t => t.name === 'validate_code');
    expect(vc.inputSchema.properties).toHaveProperty('file_path');
    expect(vc.inputSchema.required).toContain('file_path');
  });

  it('validate_intent surfaces scaffold_output and intent params', () => {
    const vi = tools.find(t => t.name === 'validate_intent');
    expect(vi.inputSchema.properties).toHaveProperty('scaffold_output');
    expect(vi.inputSchema.properties).toHaveProperty('intent');
  });
});
