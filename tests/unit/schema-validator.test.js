import { describe, it, expect } from 'bun:test';
import { validateSchema } from '../../src/core/schema-validator.js';

function validate(content, filePath = 'app/schema/product.yml') {
  return validateSchema(content, filePath);
}

// ── YAML syntax ───────────────────────────────────────────────────────────

describe('schema-validator: YAML syntax', () => {
  it('errors on invalid YAML', () => {
    const { errors } = validate('name: product\nproperties:\n  - name: title\n    missing_type');
    expect(errors.some(e => e.check === 'pos-supervisor:SchemaYAML')).toBe(true);
  });

  it('errors on completely empty file', () => {
    const { errors } = validate('');
    expect(errors.some(e => e.check === 'pos-supervisor:SchemaStructure')).toBe(true);
  });

  it('errors on non-object YAML', () => {
    const { errors } = validate('just a string');
    expect(errors.some(e => e.check === 'pos-supervisor:SchemaStructure')).toBe(true);
  });
});

// ── Top-level structure ───────────────────────────────────────────────────

describe('schema-validator: top-level structure', () => {
  it('errors when name is missing', () => {
    const { errors } = validate('properties:\n  - name: title\n    type: string');
    expect(errors.some(e => e.message.includes('missing required `name`'))).toBe(true);
  });

  it('errors when properties is missing', () => {
    const { errors } = validate('name: product');
    expect(errors.some(e => e.message.includes('missing required `properties`'))).toBe(true);
  });

  it('errors when properties is not an array', () => {
    const { errors } = validate('name: product\nproperties: not_array');
    expect(errors.some(e => e.message.includes('must be an array'))).toBe(true);
  });

  it('warns on unknown top-level key', () => {
    const { warnings } = validate('name: product\ntype: table\nproperties:\n  - name: title\n    type: string');
    expect(warnings.some(w => w.message.includes('Unknown top-level key `type`'))).toBe(true);
  });

  it('passes valid schema with no warnings', () => {
    const { errors, warnings } = validate('name: product\nproperties:\n  - name: title\n    type: string');
    expect(errors.length).toBe(0);
    expect(warnings.length).toBe(0);
  });
});

// ── Name vs filename ──────────────────────────────────────────────────────

describe('schema-validator: name vs filename', () => {
  it('warns when name does not match filename', () => {
    const { warnings } = validate(
      'name: order\nproperties:\n  - name: title\n    type: string',
      'app/schema/product.yml'
    );
    expect(warnings.some(w => w.check === 'pos-supervisor:SchemaNameMismatch')).toBe(true);
  });

  it('does not warn when name matches filename', () => {
    const { warnings } = validate(
      'name: product\nproperties:\n  - name: title\n    type: string',
      'app/schema/product.yml'
    );
    expect(warnings.some(w => w.check === 'pos-supervisor:SchemaNameMismatch')).toBe(false);
  });
});

// ── Property validation ───────────────────────────────────────────────────

describe('schema-validator: property validation', () => {
  it('errors when property is not an object', () => {
    const { errors } = validate('name: product\nproperties:\n  - just_a_string');
    expect(errors.some(e => e.check === 'pos-supervisor:SchemaProperty' && e.message.includes('must be an object'))).toBe(true);
  });

  it('errors when property name is missing', () => {
    const { errors } = validate('name: product\nproperties:\n  - type: string');
    expect(errors.some(e => e.message.includes('Missing required `name`'))).toBe(true);
  });

  it('errors when property type is missing', () => {
    const { errors } = validate('name: product\nproperties:\n  - name: title');
    expect(errors.some(e => e.message.includes('Missing required `type`'))).toBe(true);
  });

  it('errors on invalid type', () => {
    const { errors } = validate('name: product\nproperties:\n  - name: title\n    type: invalid_type');
    const e = errors.find(e => e.check === 'pos-supervisor:SchemaPropertyType');
    expect(e).toBeDefined();
    expect(e.message).toContain('invalid_type');
    expect(e.message).toContain('Valid types');
  });

  it('suggests correct type for common aliases', () => {
    const { errors } = validate('name: product\nproperties:\n  - name: count\n    type: int');
    const e = errors.find(e => e.check === 'pos-supervisor:SchemaPropertyType');
    expect(e).toBeDefined();
    expect(e.message).toContain('Did you mean `integer`');
  });

  it('suggests float for double', () => {
    const { errors } = validate('name: product\nproperties:\n  - name: price\n    type: double');
    expect(errors.some(e => e.message.includes('Did you mean `float`'))).toBe(true);
  });

  it('suggests boolean for bool', () => {
    const { errors } = validate('name: product\nproperties:\n  - name: active\n    type: bool');
    expect(errors.some(e => e.message.includes('Did you mean `boolean`'))).toBe(true);
  });

  it('suggests upload for file', () => {
    const { errors } = validate('name: product\nproperties:\n  - name: doc\n    type: file');
    expect(errors.some(e => e.message.includes('Did you mean `upload`'))).toBe(true);
  });

  it('errors on duplicate property names', () => {
    const content = 'name: product\nproperties:\n  - name: title\n    type: string\n  - name: title\n    type: text';
    const { errors } = validate(content);
    expect(errors.some(e => e.message.includes('Duplicate property name `title`'))).toBe(true);
  });

  it('errors on built-in field name', () => {
    const content = 'name: product\nproperties:\n  - name: id\n    type: string';
    const { errors } = validate(content);
    expect(errors.some(e => e.message.includes('conflicts with built-in field'))).toBe(true);
  });

  it('errors on created_at built-in', () => {
    const content = 'name: product\nproperties:\n  - name: created_at\n    type: datetime';
    const { errors } = validate(content);
    expect(errors.some(e => e.message.includes('conflicts with built-in field'))).toBe(true);
  });

  it('warns on non-snake_case property name', () => {
    const content = 'name: product\nproperties:\n  - name: productTitle\n    type: string';
    const { warnings } = validate(content);
    expect(warnings.some(w => w.message.includes('snake_case'))).toBe(true);
  });

  it('does not warn on valid snake_case name', () => {
    const content = 'name: product\nproperties:\n  - name: product_title\n    type: string';
    const { warnings } = validate(content);
    expect(warnings.some(w => w.message.includes('snake_case'))).toBe(false);
  });

  it('errors on property name starting with a digit', () => {
    const content = 'name: product\nproperties:\n  - name: 123invalid\n    type: string';
    const { errors } = validate(content);
    const e = errors.find(e => e.message.includes('must start with a letter'));
    expect(e).toBeDefined();
    expect(e.severity).toBe('error');
  });

  it('errors on misleading required key', () => {
    const content = 'name: product\nproperties:\n  - name: title\n    type: string\n    required: true';
    const { errors } = validate(content);
    const e = errors.find(e => e.message.includes('required'));
    expect(e).toBeDefined();
    expect(e.severity).toBe('error');
    expect(e.message).toContain('not a schema-level concept');
  });

  it('errors on misleading default key', () => {
    const content = 'name: product\nproperties:\n  - name: count\n    type: integer\n    default: 0';
    const { errors } = validate(content);
    const e = errors.find(e => e.message.includes('default'));
    expect(e).toBeDefined();
    expect(e.severity).toBe('error');
    expect(e.message).toContain('not supported');
  });

  it('errors on misleading unique key', () => {
    const content = 'name: product\nproperties:\n  - name: slug\n    type: string\n    unique: true';
    const { errors } = validate(content);
    expect(errors.some(e => e.message.includes('unique') && e.message.includes('not enforced'))).toBe(true);
  });

  it('errors on misleading belongs_to key', () => {
    const content = 'name: order\nproperties:\n  - name: user\n    type: string\n    belongs_to: user';
    const { errors } = validate(content);
    expect(errors.some(e => e.message.includes('belongs_to') && e.message.includes('not a schema key'))).toBe(true);
  });

  it('warns on truly unknown property key', () => {
    const content = 'name: product\nproperties:\n  - name: title\n    type: string\n    foo_bar: baz';
    const { warnings } = validate(content);
    expect(warnings.some(w => w.message.includes('unknown key `foo_bar`'))).toBe(true);
  });
});

// ── Valid types ───────────────────────────────────────────────────────────

describe('schema-validator: all valid types', () => {
  const validTypes = ['string', 'text', 'integer', 'float', 'boolean', 'datetime', 'date', 'array', 'upload'];

  for (const type of validTypes) {
    it(`accepts type: ${type}`, () => {
      const content = `name: product\nproperties:\n  - name: field\n    type: ${type}`;
      const { errors } = validate(content);
      expect(errors.some(e => e.check === 'pos-supervisor:SchemaPropertyType')).toBe(false);
    });
  }
});

// ── Upload options ────────────────────────────────────────────────────────

describe('schema-validator: upload options', () => {
  it('accepts valid upload with options', () => {
    const content = 'name: product\nproperties:\n  - name: image\n    type: upload\n    options:\n      acl: public\n      max_size: 5242880\n      content_type:\n        - image/jpeg';
    const { errors, warnings } = validate(content);
    expect(errors.length).toBe(0);
    expect(warnings.length).toBe(0);
  });

  it('errors on invalid acl value', () => {
    const content = 'name: product\nproperties:\n  - name: image\n    type: upload\n    options:\n      acl: read_only';
    const { errors } = validate(content);
    expect(errors.some(e => e.message.includes('Invalid acl value'))).toBe(true);
  });

  it('errors on non-numeric max_size', () => {
    const content = 'name: product\nproperties:\n  - name: image\n    type: upload\n    options:\n      max_size: big';
    const { errors } = validate(content);
    expect(errors.some(e => e.message.includes('max_size'))).toBe(true);
  });

  it('errors on non-array content_type', () => {
    const content = 'name: product\nproperties:\n  - name: image\n    type: upload\n    options:\n      content_type: image/jpeg';
    const { errors } = validate(content);
    expect(errors.some(e => e.message.includes('content_type') && e.message.includes('array'))).toBe(true);
  });

  it('warns on unknown upload option', () => {
    const content = 'name: product\nproperties:\n  - name: image\n    type: upload\n    options:\n      acl: public\n      resize: true';
    const { warnings } = validate(content);
    expect(warnings.some(w => w.message.includes('Unknown upload option `resize`'))).toBe(true);
  });

  it('warns when options used on non-upload type', () => {
    const content = 'name: product\nproperties:\n  - name: title\n    type: string\n    options:\n      max_length: 255';
    const { warnings } = validate(content);
    expect(warnings.some(w => w.message.includes('only valid for `upload`'))).toBe(true);
  });
});

// ── Line numbers ──────────────────────────────────────────────────────────

describe('schema-validator: line numbers', () => {
  it('reports correct line for invalid type', () => {
    const content = 'name: product\nproperties:\n  - name: title\n    type: string\n  - name: price\n    type: invalid';
    const { errors } = validate(content);
    const e = errors.find(e => e.check === 'pos-supervisor:SchemaPropertyType');
    expect(e).toBeDefined();
    expect(e.line).toBe(4); // 0-based, "  - name: price" is line 4
  });

  it('reports correct line for name mismatch', () => {
    const content = 'name: wrong\nproperties:\n  - name: x\n    type: string';
    const { warnings } = validate(content, 'app/schema/product.yml');
    const w = warnings.find(w => w.check === 'pos-supervisor:SchemaNameMismatch');
    expect(w).toBeDefined();
    expect(w.line).toBe(0);
  });
});

// ── Complex valid schema ──────────────────────────────────────────────────

describe('schema-validator: complex valid schema', () => {
  it('validates a full realistic schema', () => {
    const content = `name: blog_post
properties:
  - name: title
    type: string
  - name: slug
    type: string
  - name: body
    type: text
  - name: author_id
    type: string
  - name: published
    type: boolean
  - name: published_at
    type: datetime
  - name: view_count
    type: integer
  - name: rating
    type: float
  - name: tags
    type: array
  - name: cover_image
    type: upload
    options:
      acl: public
      max_size: 10485760
      content_type:
        - image/jpeg
        - image/png
        - image/webp`;
    const { errors, warnings } = validate(content, 'app/schema/blog_post.yml');
    expect(errors.length).toBe(0);
    expect(warnings.length).toBe(0);
  });
});
