import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';
import { pluralize } from './project-scanner.js';

const BUILTIN_FIELDS = new Set([
  'id', 'created_at', 'updated_at', 'deleted_at', 'table', 'type',
]);

const TYPE_TO_ACCESSOR = {
  string: 'property',
  text: 'property',
  datetime: 'property',
  date: 'property',
  integer: 'property_int',
  float: 'property_float',
  boolean: 'property_boolean',
  array: 'property_array',
  upload: 'property',
};

const TYPE_TO_VALUE_KEY = {
  string: 'value',
  text: 'value',
  datetime: 'value',
  date: 'value',
  integer: 'value_int',
  float: 'value_float',
  boolean: 'value_boolean',
  array: 'value_array',
  upload: 'value',
};

const ACCESSOR_REGEX = /\b(property(?:_int|_float|_boolean|_array)?)\s*\(\s*name\s*:\s*"([^"]+)"\s*\)/g;

const TABLE_REGEX = /table\s*:\s*(?:\{\s*value\s*:\s*)?"([^"]+)"/g;

const MUTATION_PROP_REGEX = /\{\s*name\s*:\s*"([^"]+)"\s*,\s*(value(?:_int|_float|_boolean|_array)?)\s*:/g;

export function checkSchemaProperties(content, filePath, projectDir) {
  const warnings = [];

  if (!projectDir || !content) return { warnings };

  const tableNames = extractTableNames(content, filePath);
  if (tableNames.length === 0) return { warnings };

  const schemaMap = loadSchemas(projectDir, tableNames);
  if (Object.keys(schemaMap).length === 0) return { warnings };

  checkAccessors(content, tableNames, schemaMap, warnings);
  checkMutationProperties(content, tableNames, schemaMap, warnings);

  return { warnings };
}

export function extractTableNames(content, filePath) {
  const names = new Set();

  TABLE_REGEX.lastIndex = 0;
  let m;
  while ((m = TABLE_REGEX.exec(content)) !== null) {
    const name = m[1];
    if (!name.startsWith('modules/')) {
      names.add(name);
    }
  }

  if (names.size === 0 && filePath) {
    const pathTable = resolveTableFromPath(filePath);
    if (pathTable) names.add(pathTable);
  }

  return [...names];
}

export function resolveTableFromPath(filePath) {
  const m = filePath.match(/(?:^|\/)(app\/graphql\/)([^/]+)\//);
  if (!m) return null;
  const dirName = m[2];
  return singularize(dirName);
}

function singularize(name) {
  if (name.endsWith('ies') && name.length > 3) {
    return name.slice(0, -3) + 'y';
  }
  if (name.endsWith('ses') || name.endsWith('xes') || name.endsWith('zes') ||
      name.endsWith('ches') || name.endsWith('shes')) {
    return name.slice(0, -2);
  }
  if (name.endsWith('s') && !name.endsWith('ss')) {
    return name.slice(0, -1);
  }
  return name;
}

export function loadSchemas(projectDir, tableNames) {
  const schemaDir = join(projectDir, 'app', 'schema');
  if (!existsSync(schemaDir)) return {};

  const result = {};
  for (const tableName of tableNames) {
    const ymlPath = join(schemaDir, `${tableName}.yml`);
    const yamlPath = join(schemaDir, `${tableName}.yaml`);
    const filePath = existsSync(ymlPath) ? ymlPath : existsSync(yamlPath) ? yamlPath : null;
    if (!filePath) continue;

    try {
      const raw = readFileSync(filePath, 'utf8');
      const doc = yaml.load(raw);
      if (doc?.properties && Array.isArray(doc.properties)) {
        const props = new Map();
        for (const p of doc.properties) {
          if (p.name && p.type) {
            props.set(p.name, p.type);
          }
        }
        result[tableName] = props;
      }
    } catch { /* skip unparseable schemas */ }
  }

  return result;
}

function checkAccessors(content, tableNames, schemaMap, warnings) {
  ACCESSOR_REGEX.lastIndex = 0;
  let m;
  while ((m = ACCESSOR_REGEX.exec(content)) !== null) {
    const accessor = m[1];
    const propName = m[2];

    if (BUILTIN_FIELDS.has(propName)) continue;

    for (const tableName of tableNames) {
      const schema = schemaMap[tableName];
      if (!schema) continue;

      const schemaType = schema.get(propName);
      if (schemaType === undefined) {
        warnings.push({
          check: 'pos-supervisor:UnknownSchemaProperty',
          severity: 'warning',
          message: `Property \`${propName}\` is not defined in schema \`${tableName}\`. Defined properties: ${[...schema.keys()].join(', ') || '(none)'}.`,
          line: lineOf(content, m.index),
        });
      } else {
        const expectedAccessor = TYPE_TO_ACCESSOR[schemaType];
        if (expectedAccessor && accessor !== expectedAccessor) {
          warnings.push({
            check: 'pos-supervisor:SchemaPropertyTypeMismatch',
            severity: 'warning',
            message: `Property \`${propName}\` has type \`${schemaType}\` in schema \`${tableName}\`, which requires \`${expectedAccessor}\` — found \`${accessor}\`.`,
            line: lineOf(content, m.index),
          });
        }
      }
    }
  }
}

function checkMutationProperties(content, tableNames, schemaMap, warnings) {
  MUTATION_PROP_REGEX.lastIndex = 0;
  let m;
  while ((m = MUTATION_PROP_REGEX.exec(content)) !== null) {
    const propName = m[1];
    const valueKey = m[2];

    if (BUILTIN_FIELDS.has(propName)) continue;

    for (const tableName of tableNames) {
      const schema = schemaMap[tableName];
      if (!schema) continue;

      const schemaType = schema.get(propName);
      if (schemaType === undefined) {
        warnings.push({
          check: 'pos-supervisor:UnknownSchemaProperty',
          severity: 'warning',
          message: `Property \`${propName}\` is not defined in schema \`${tableName}\`. Defined properties: ${[...schema.keys()].join(', ') || '(none)'}.`,
          line: lineOf(content, m.index),
        });
      } else {
        const expectedValueKey = TYPE_TO_VALUE_KEY[schemaType];
        if (expectedValueKey && valueKey !== expectedValueKey) {
          warnings.push({
            check: 'pos-supervisor:SchemaPropertyTypeMismatch',
            severity: 'warning',
            message: `Property \`${propName}\` has type \`${schemaType}\` in schema \`${tableName}\`, which requires \`${expectedValueKey}\` — found \`${valueKey}\`.`,
            line: lineOf(content, m.index),
          });
        }
      }
    }
  }
}

function lineOf(content, charIndex) {
  let line = 0;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}
