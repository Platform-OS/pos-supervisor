import { readFile } from 'node:fs/promises';

export class TagsIndex {
  constructor() {
    this._byName = new Map();
    this._loaded = false;
  }

  async load(tagsPath) {
    const json = JSON.parse(await readFile(tagsPath, 'utf8'));
    for (const t of json) {
      this._byName.set(t.name, {
        name:       t.name,
        syntax:     t.syntax     ?? '',
        summary:    t.summary    ?? '',
        parameters: t.parameters ?? [],
        platformOS: t.platformOS === true,
        deprecated: t.deprecated === true,
      });
    }
    this._loaded = true;
  }

  get loaded() { return this._loaded; }

  lookup(tagName) {
    if (!this._loaded || !tagName) return null;
    return this._byName.get(tagName) ?? null;
  }

  lookupMany(tagNames) {
    if (!this._loaded) return [];
    const results = [];
    for (const name of tagNames) {
      const t = this._byName.get(name);
      if (t) results.push(t);
    }
    return results;
  }

  platformOSTags() {
    if (!this._loaded) return [];
    return [...this._byName.values()]
      .filter(t => t.platformOS && !t.deprecated)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  isTag(name) {
    if (!this._loaded || !name) return false;
    return this._byName.has(name);
  }
}
