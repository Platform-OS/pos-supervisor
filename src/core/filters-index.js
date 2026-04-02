import { readFile } from 'node:fs/promises';

export class FiltersIndex {
  constructor() {
    this._byName = new Map();
    this._loaded = false;
  }

  async load(filtersPath) {
    const json = JSON.parse(await readFile(filtersPath, 'utf8'));
    for (const f of json) {
      this._byName.set(f.name, {
        name:       f.name,
        category:   f.category ?? '',
        syntax:     f.syntax   ?? '',
        summary:    f.summary  ?? '',
        parameters: f.parameters ?? [],
        platformOS: f.platformOS === true,
        deprecated: f.deprecated === true,
      });
    }
    this._loaded = true;
  }

  get loaded() { return this._loaded; }

  lookup(filterName) {
    if (!this._loaded || !filterName) return null;
    return this._byName.get(filterName) ?? null;
  }

  lookupMany(filterNames) {
    if (!this._loaded) return [];
    const results = [];
    for (const name of filterNames) {
      const f = this._byName.get(name);
      if (f) results.push(f);
    }
    return results;
  }

  /**
   * Find the closest filter name by Levenshtein distance.
   */
  closestMatch(filterName, maxDistance = 2) {
    if (!this._loaded || !filterName) return null;
    let best = null;
    let bestDist = maxDistance + 1;
    for (const [name, entry] of this._byName) {
      const d = levenshtein(filterName.toLowerCase(), name.toLowerCase());
      if (d < bestDist) {
        bestDist = d;
        best = entry;
      }
    }
    return best;
  }

  platformOSFilters() {
    if (!this._loaded) return [];
    return [...this._byName.values()]
      .filter(f => f.platformOS && !f.deprecated)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
