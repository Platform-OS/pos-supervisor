import { readFile } from 'node:fs/promises';

function extractBlock(text, typeName) {
  const re = new RegExp(`^type\\s+${typeName}\\s*\\{`, 'm');
  const match = re.exec(text);
  if (!match) return null;

  let depth = 0;
  let start = -1;
  let inTriple = false;
  let i = match.index;

  while (i < text.length) {
    if (text[i] === '"' && text[i + 1] === '"' && text[i + 2] === '"') {
      inTriple = !inTriple;
      i += 3;
      continue;
    }
    if (inTriple) { i++; continue; }

    if (text[i] === '{') {
      if (++depth === 1) start = i + 1;
    } else if (text[i] === '}') {
      if (--depth === 0) return text.slice(start, i);
    }
    i++;
  }
  return null;
}

export function condenseArgs(rawArgs) {
  const parts = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\[?[A-Za-z_][A-Za-z0-9_]*!?\]?!?)/g;
  let m;
  while ((m = re.exec(rawArgs)) !== null) {
    parts.push(`${m[1]}: ${m[2]}`);
  }
  return parts.join(', ');
}

export function parseRootFields(blockText) {
  const fields = [];
  const lines = blockText.split('\n').map(l => l.trim());
  let i = 0;
  let pendingDescription = '';

  while (i < lines.length) {
    const line = lines[i];

    if (line === '"""') {
      const docParts = [];
      i++;
      while (i < lines.length && lines[i] !== '"""') {
        docParts.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      pendingDescription = docParts.join(' ').trim();
      continue;
    }

    if (!line) { i++; continue; }

    const fieldMatch = line.match(/^([a-z_][a-z0-9_]*)\s*[(:]/);
    if (!fieldMatch) {
      pendingDescription = '';
      i++;
      continue;
    }

    const description = pendingDescription;
    pendingDescription = '';

    const fieldLines = [line];
    let parenDepth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
    i++;

    while (parenDepth > 0 && i < lines.length) {
      const fl = lines[i];
      if (fl === '"""') {
        i++;
        while (i < lines.length && lines[i] !== '"""') i++;
        if (i < lines.length) i++;
        continue;
      }
      fieldLines.push(fl);
      parenDepth += (fl.match(/\(/g) || []).length - (fl.match(/\)/g) || []).length;
      i++;
    }

    const fullText = fieldLines.join(' ');
    const name = fieldMatch[1];

    let args = '';
    let returnType = '';

    const argsMatch = fullText.match(/\(([^)]*)\):\s*(\S+)/);
    if (argsMatch) {
      args = condenseArgs(argsMatch[1]);
      returnType = argsMatch[2];
    } else {
      const simpleMatch = fullText.match(/^[a-z_][a-z0-9_]*\s*:\s*(\S+)/);
      if (simpleMatch) returnType = simpleMatch[1];
    }

    const catMatch = fullText.match(/@doc\(category:\s*"([^"]+)"\)/);
    const category = catMatch ? catMatch[1] : '';

    fields.push({ name, args, returnType, description, category });
  }

  return fields;
}

function parseTypeNames(text) {
  const types = new Map();
  const re = /^(type|input|enum|interface|scalar)\s+([A-Z][A-Za-z0-9_]*)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, kind, name] = m;
    if (name !== 'RootQuery' && name !== 'RootMutation') {
      types.set(name, kind);
    }
  }
  return types;
}

export class SchemaIndex {
  constructor() {
    this._queries   = [];
    this._mutations = [];
    this._types     = new Map();
    this._loaded    = false;
    this._loading   = null;
  }

  async load(schemaPath) {
    if (this._loading) return this._loading;
    this._loading = (async () => {
      const text = await readFile(schemaPath, 'utf8');
      const queryBlock    = extractBlock(text, 'RootQuery');
      const mutationBlock = extractBlock(text, 'RootMutation');
      if (queryBlock)    this._queries   = parseRootFields(queryBlock);
      if (mutationBlock) this._mutations = parseRootFields(mutationBlock);
      this._types = parseTypeNames(text);
      this._loaded = true;
    })();
    return this._loading;
  }

  get loaded() { return this._loaded; }

  search(term) {
    if (!this._loaded) return { queries: [], mutations: [], types: [], notLoaded: true };

    const t = term.toLowerCase();
    const queries   = this._queries.filter(q => q.name.toLowerCase().includes(t));
    const mutations = this._mutations.filter(m => m.name.toLowerCase().includes(t));
    const types     = [...this._types.entries()]
      .filter(([name]) => name.toLowerCase().includes(t))
      .map(([name, kind]) => ({ name, kind }));

    return { queries, mutations, types, notLoaded: false };
  }
}
