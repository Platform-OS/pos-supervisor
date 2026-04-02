import { readFile } from 'node:fs/promises';

export class ObjectsIndex {
  constructor() {
    this._byName = new Map();
    this._loaded = false;
  }

  async load(objectsPath) {
    const json = JSON.parse(await readFile(objectsPath, 'utf8'));
    for (const obj of json) {
      const { name, json_data, properties } = obj;
      const handle   = json_data?.handle ?? '';
      const propNames = (properties ?? []).map(p => p.name).filter(Boolean);
      this._byName.set(name, { name, handle, properties: propNames });
    }
    this._loaded = true;
  }

  get loaded() { return this._loaded; }

  contextObjects() {
    if (!this._loaded) return [];
    return [...this._byName.values()]
      .filter(obj => /^context\.[a-z_]+$/.test(obj.handle))
      .sort((a, b) => b.properties.length - a.properties.length);
  }

  lookup(varName) {
    if (!this._loaded || !varName) return null;
    const obj = this._byName.get(varName);
    if (!obj) return null;
    if (!obj.handle || obj.handle === varName) return null;
    return obj;
  }
}

export function extractVarName(message) {
  if (!message) return null;
  const dq = message.match(/"([^"]+)"/);
  if (dq) return dq[1];
  const sq = message.match(/'([^']+)'/);
  if (sq) return sq[1];
  return null;
}
