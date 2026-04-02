/**
 * platformOS schema YAML validator.
 *
 * Validates schema files (app/schema/*.yml) for:
 *   - Valid YAML syntax
 *   - Required top-level keys (name, properties)
 *   - name matches filename
 *   - Each property has required keys (name, type)
 *   - Valid property types
 *   - No duplicate property names
 *   - Upload options validation
 *   - No use of built-in field names
 */

import yaml from 'js-yaml';
import { basename } from 'node:path';

const VALID_TYPES = new Set([
  'string', 'text', 'integer', 'float', 'boolean',
  'datetime', 'date', 'array', 'upload',
]);

const BUILTIN_FIELDS = new Set(['id', 'created_at', 'updated_at', 'table']);

const VALID_TOP_LEVEL_KEYS = new Set(['name', 'properties']);

const VALID_PROPERTY_KEYS = new Set(['name', 'type', 'options']);

// Keys that imply platform behavior that doesn't exist — these are errors, not warnings,
// because they give developers false confidence about data integrity.
const MISLEADING_PROPERTY_KEYS = {
  required:   '`required` is not a schema-level concept in platformOS. Validation must be done in mutations/commands using `{% liquid if field == blank %}` or form validators.',
  default:    '`default` is not supported in platformOS schemas. Set defaults in your mutation/command logic before `record_create`.',
  unique:     '`unique` is not enforced at the schema level in platformOS. Use `records(filter: ...)` to check uniqueness before creating records.',
  index:      '`index` is not a schema option. String properties are indexed by default; text properties are not.',
  nullable:   '`nullable` is not a schema option. All properties are nullable by default in platformOS.',
  validation: '`validation` is not a schema-level concept. Validate in mutations/commands.',
  validates:  '`validates` is not a schema-level concept. Validate in mutations/commands.',
  max_length: '`max_length` is not a schema option. Validate length in mutations/commands.',
  min_length: '`min_length` is not a schema option. Validate length in mutations/commands.',
  enum:       '`enum` is not a schema option. Use a `string` type and validate allowed values in mutations/commands.',
  foreign_key:'`foreign_key` is not a schema concept. Use `_id` suffix convention and `related_record()` in GraphQL.',
  references: '`references` is not a schema concept. Use `_id` suffix convention and `related_record()` in GraphQL.',
  belongs_to: '`belongs_to` is not a schema key. Store the ID as a `string` property with `_id` suffix and query with `related_record()`.',
  has_many:   '`has_many` is not a schema key. Query related records with `related_records()` in GraphQL.',
};

const VALID_UPLOAD_OPTIONS = new Set(['acl', 'max_size', 'content_type']);
const VALID_ACL_VALUES = new Set(['public', 'private']);

/**
 * Validate a platformOS schema YAML file.
 *
 * @param {string} content — Raw YAML content
 * @param {string} filePath — File path (for name-vs-filename check)
 * @returns {{ errors: Array, warnings: Array }}
 */
export function validateSchema(content, filePath) {
  const errors = [];
  const warnings = [];

  // 1. Parse YAML
  let doc;
  try {
    doc = yaml.load(content);
  } catch (e) {
    errors.push({
      check: 'pos-supervisor:SchemaYAML',
      severity: 'error',
      message: `Invalid YAML syntax: ${e.reason || e.message}`,
      line: e.mark?.line ?? 0,
      column: e.mark?.column ?? 0,
    });
    return { errors, warnings };
  }

  if (!doc || typeof doc !== 'object') {
    errors.push({
      check: 'pos-supervisor:SchemaStructure',
      severity: 'error',
      message: 'Schema file must contain a YAML object with `name` and `properties` keys.',
      line: 0,
      column: 0,
    });
    return { errors, warnings };
  }

  // 2. Check for unknown top-level keys
  for (const key of Object.keys(doc)) {
    if (!VALID_TOP_LEVEL_KEYS.has(key)) {
      const line = findKeyLine(content, key);
      warnings.push({
        check: 'pos-supervisor:SchemaStructure',
        severity: 'warning',
        message: `Unknown top-level key \`${key}\`. Valid keys: \`name\`, \`properties\`.`,
        line,
        column: 0,
      });
    }
  }

  // 3. Required: name
  if (!doc.name) {
    errors.push({
      check: 'pos-supervisor:SchemaStructure',
      severity: 'error',
      message: 'Schema is missing required `name` key.',
      line: 0,
      column: 0,
    });
  } else if (typeof doc.name !== 'string') {
    errors.push({
      check: 'pos-supervisor:SchemaStructure',
      severity: 'error',
      message: '`name` must be a string.',
      line: findKeyLine(content, 'name'),
      column: 0,
    });
  } else {
    // 4. name must match filename
    const expectedName = basename(filePath, '.yml');
    if (doc.name !== expectedName) {
      warnings.push({
        check: 'pos-supervisor:SchemaNameMismatch',
        severity: 'warning',
        message: `Schema \`name: ${doc.name}\` does not match filename \`${expectedName}.yml\`. The name should match the filename.`,
        line: findKeyLine(content, 'name'),
        column: 0,
      });
    }
  }

  // 5. Required: properties
  if (!doc.properties) {
    errors.push({
      check: 'pos-supervisor:SchemaStructure',
      severity: 'error',
      message: 'Schema is missing required `properties` key.',
      line: 0,
      column: 0,
    });
    return { errors, warnings };
  }

  if (!Array.isArray(doc.properties)) {
    errors.push({
      check: 'pos-supervisor:SchemaStructure',
      severity: 'error',
      message: '`properties` must be an array of property definitions.',
      line: findKeyLine(content, 'properties'),
      column: 0,
    });
    return { errors, warnings };
  }

  // 6. Validate each property
  const seenNames = new Set();

  for (let i = 0; i < doc.properties.length; i++) {
    const prop = doc.properties[i];
    const propLabel = `properties[${i}]`;

    if (!prop || typeof prop !== 'object') {
      errors.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'error',
        message: `${propLabel}: Each property must be an object with \`name\` and \`type\` keys.`,
        line: findPropertyLine(content, i),
        column: 0,
      });
      continue;
    }

    // Check for unknown/misleading property keys
    for (const key of Object.keys(prop)) {
      if (VALID_PROPERTY_KEYS.has(key)) continue;

      const misleadingMsg = MISLEADING_PROPERTY_KEYS[key];
      if (misleadingMsg) {
        errors.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'error',
          message: `Property \`${prop.name || propLabel}\`: ${misleadingMsg}`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      } else {
        warnings.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'warning',
          message: `Property \`${prop.name || propLabel}\`: unknown key \`${key}\`. Valid keys: \`name\`, \`type\`, \`options\`.`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      }
    }

    // Required: name
    if (!prop.name) {
      errors.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'error',
        message: `${propLabel}: Missing required \`name\` key.`,
        line: findPropertyLine(content, i),
        column: 0,
      });
    } else if (typeof prop.name !== 'string') {
      errors.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'error',
        message: `${propLabel}: \`name\` must be a string.`,
        line: findPropertyLine(content, i),
        column: 0,
      });
    } else {
      // Duplicate check
      if (seenNames.has(prop.name)) {
        errors.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'error',
          message: `Duplicate property name \`${prop.name}\`. Property names must be unique within a schema.`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      }
      seenNames.add(prop.name);

      // Built-in field name check
      if (BUILTIN_FIELDS.has(prop.name)) {
        errors.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'error',
          message: `Property name \`${prop.name}\` conflicts with built-in field. Built-in fields (id, created_at, updated_at, table) are added automatically.`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      }

      // Property name must start with a letter (platformOS DB constraint)
      if (/^\d/.test(prop.name)) {
        errors.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'error',
          message: `Property name \`${prop.name}\` must start with a letter, not a digit.`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      }
      // snake_case check
      else if (prop.name !== prop.name.toLowerCase() || /[^a-z0-9_]/.test(prop.name)) {
        warnings.push({
          check: 'pos-supervisor:SchemaProperty',
          severity: 'warning',
          message: `Property name \`${prop.name}\` should use snake_case (lowercase letters, numbers, underscores).`,
          line: findPropertyLine(content, i),
          column: 0,
        });
      }
    }

    // Required: type
    if (!prop.type) {
      errors.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'error',
        message: `Property \`${prop.name || propLabel}\`: Missing required \`type\` key.`,
        line: findPropertyLine(content, i),
        column: 0,
      });
    } else if (!VALID_TYPES.has(prop.type)) {
      const suggestion = suggestType(prop.type);
      errors.push({
        check: 'pos-supervisor:SchemaPropertyType',
        severity: 'error',
        message: `Property \`${prop.name || propLabel}\`: Invalid type \`${prop.type}\`. Valid types: ${[...VALID_TYPES].join(', ')}.${suggestion ? ` Did you mean \`${suggestion}\`?` : ''}`,
        line: findPropertyLine(content, i),
        column: 0,
      });
    }

    // Upload options validation
    if (prop.type === 'upload' && prop.options) {
      validateUploadOptions(prop, content, i, errors, warnings);
    } else if (prop.options && prop.type !== 'upload') {
      warnings.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'warning',
        message: `Property \`${prop.name}\`: \`options\` is only valid for \`upload\` type properties.`,
        line: findPropertyLine(content, i),
        column: 0,
      });
    }
  }

  return { errors, warnings };
}

function validateUploadOptions(prop, content, propIndex, errors, warnings) {
  const opts = prop.options;
  if (typeof opts !== 'object' || Array.isArray(opts)) {
    errors.push({
      check: 'pos-supervisor:SchemaProperty',
      severity: 'error',
      message: `Property \`${prop.name}\`: \`options\` must be an object.`,
      line: findPropertyLine(content, propIndex),
      column: 0,
    });
    return;
  }

  for (const key of Object.keys(opts)) {
    if (!VALID_UPLOAD_OPTIONS.has(key)) {
      warnings.push({
        check: 'pos-supervisor:SchemaProperty',
        severity: 'warning',
        message: `Property \`${prop.name}\`: Unknown upload option \`${key}\`. Valid options: acl, max_size, content_type.`,
        line: findPropertyLine(content, propIndex),
        column: 0,
      });
    }
  }

  if (opts.acl && !VALID_ACL_VALUES.has(opts.acl)) {
    errors.push({
      check: 'pos-supervisor:SchemaProperty',
      severity: 'error',
      message: `Property \`${prop.name}\`: Invalid acl value \`${opts.acl}\`. Must be \`public\` or \`private\`.`,
      line: findPropertyLine(content, propIndex),
      column: 0,
    });
  }

  if (opts.max_size != null && (typeof opts.max_size !== 'number' || opts.max_size <= 0)) {
    errors.push({
      check: 'pos-supervisor:SchemaProperty',
      severity: 'error',
      message: `Property \`${prop.name}\`: \`max_size\` must be a positive number (bytes).`,
      line: findPropertyLine(content, propIndex),
      column: 0,
    });
  }

  if (opts.content_type != null && !Array.isArray(opts.content_type)) {
    errors.push({
      check: 'pos-supervisor:SchemaProperty',
      severity: 'error',
      message: `Property \`${prop.name}\`: \`content_type\` must be an array of MIME type strings.`,
      line: findPropertyLine(content, propIndex),
      column: 0,
    });
  }
}

/**
 * Find the 0-based line number where a top-level key appears.
 */
function findKeyLine(content, key) {
  const lines = content.split('\n');
  const re = new RegExp(`^${key}:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return 0;
}

/**
 * Find the 0-based line number of the i-th `- name:` in the properties array.
 */
function findPropertyLine(content, index) {
  const lines = content.split('\n');
  let count = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+-\s+name:/.test(lines[i]) || /^\s+-\s+\{/.test(lines[i])) {
      count++;
      if (count === index) return i;
    }
  }
  // Fallback: find the properties line
  return findKeyLine(content, 'properties');
}

/**
 * Suggest a valid type name for common typos.
 */
function suggestType(invalidType) {
  const lower = invalidType.toLowerCase();
  const aliases = {
    str: 'string', string: 'string', varchar: 'string', char: 'string',
    int: 'integer', number: 'integer', bigint: 'integer', smallint: 'integer',
    double: 'float', decimal: 'float', numeric: 'float', real: 'float',
    bool: 'boolean', bit: 'boolean',
    timestamp: 'datetime', time: 'datetime',
    blob: 'upload', file: 'upload', image: 'upload',
    json: 'array', list: 'array',
    longtext: 'text', mediumtext: 'text', varchar2: 'string',
  };
  return aliases[lower] ?? null;
}
