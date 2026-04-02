import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RESOURCES = [
  {
    uri: 'pos-supervisor://knowledge/platformos-synthesis',
    name: 'platformos-synthesis',
    title: 'platformOS Complete Knowledge Reference',
    description: 'Complete platformOS patterns, architecture rules, and API reference. Load at session start for full platform context.',
    mimeType: 'text/markdown',
    annotations: {
      audience: ['assistant'],
      priority: 1.0,
    },
    _filePath: join(__dirname, 'data', 'resources', 'platformos-synthesis.md'),
  },
];

export function listResources() {
  return { resources: RESOURCES.map(({ _filePath, ...r }) => r) };
}

export async function readResource(uri) {
  const resource = RESOURCES.find(r => r.uri === uri);
  if (!resource) {
    return { error: { code: -32002, message: 'Resource not found', data: { uri } } };
  }
  const text = await readFile(resource._filePath, 'utf-8');
  return {
    contents: [{
      uri: resource.uri,
      mimeType: resource.mimeType,
      text,
    }],
  };
}
