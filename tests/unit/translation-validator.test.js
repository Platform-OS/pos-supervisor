import { describe, it, expect } from 'bun:test';
import { validateTranslationYaml } from '../../src/core/translation-validator.js';

function validate(content, filePath = 'app/translations/en.yml') {
  return validateTranslationYaml(content, filePath);
}

describe('translation-validator: missing top-level locale key', () => {
  it('errors when the tree has no locale wrapper', () => {
    const yaml = `app:
  contact_form:
    title: "Contact us"
    success: "Thanks"
`;
    const { errors } = validate(yaml);
    expect(errors.some(e => e.check === 'pos-supervisor:TranslationMissingLocaleKey')).toBe(true);
    expect(errors[0].message).toMatch(/en:/);
  });

  it('suggests the filename-based locale when available', () => {
    const { errors } = validate('app:\n  title: x\n', 'app/translations/de.yml');
    expect(errors[0].message).toMatch(/de:/);
  });

  it('falls back to en when filename is not a locale', () => {
    const { errors } = validate('app:\n  title: x\n', 'app/translations/strings.yml');
    expect(errors[0].message).toMatch(/en:/);
  });

  it('rejects multiple non-locale top-level keys', () => {
    const yaml = `app:
  title: x
ecommerce:
  cart: y
`;
    const { errors } = validate(yaml);
    expect(errors).toHaveLength(1);
    expect(errors[0].check).toBe('pos-supervisor:TranslationMissingLocaleKey');
  });

  it('errors when top-level key looks like a typo locale (enff, enn, etc.)', () => {
    const yaml = `enff:
  app:
    hello: "Hello"
`;
    const { errors } = validate(yaml);
    expect(errors).toHaveLength(1);
    expect(errors[0].check).toBe('pos-supervisor:TranslationMissingLocaleKey');
    expect(errors[0].message).toMatch(/enff/);
  });
});

describe('translation-validator: valid locale wrappers', () => {
  it('passes a correctly wrapped file', () => {
    const yaml = `en:
  app:
    contact_form:
      title: "Contact"
`;
    const { errors, warnings } = validate(yaml);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('accepts two-letter locale with region (pt-BR)', () => {
    const { errors } = validate('pt-BR:\n  app:\n    title: "x"\n', 'app/translations/pt-BR.yml');
    expect(errors).toHaveLength(0);
  });

  it('accepts a multi-locale file', () => {
    const yaml = `en:
  app:
    title: "Contact"
de:
  app:
    title: "Kontakt"
`;
    const { errors, warnings } = validate(yaml);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});

describe('translation-validator: mixed top-level keys', () => {
  it('warns per stray non-locale key when at least one locale is present', () => {
    const yaml = `en:
  app:
    title: "x"
app:
  title: "y"
`;
    const { errors, warnings } = validate(yaml);
    expect(errors).toHaveLength(0);
    expect(warnings.some(w => w.check === 'pos-supervisor:TranslationStrayTopKey' && w.message.includes('`app`'))).toBe(true);
  });
});

describe('translation-validator: edge cases', () => {
  it('returns nothing on empty content', () => {
    const { errors, warnings } = validate('');
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('returns nothing on comment-only content', () => {
    const { errors, warnings } = validate('# just a comment\n');
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('errors on invalid YAML syntax', () => {
    const { errors } = validate('en:\n  app:\n    title: "unterminated');
    expect(errors.some(e => e.check === 'pos-supervisor:TranslationYAML')).toBe(true);
  });

  it('errors when root is an array', () => {
    const { errors } = validate('- one\n- two\n');
    expect(errors.some(e => e.check === 'pos-supervisor:TranslationStructure')).toBe(true);
  });

  it('errors when root is a scalar string', () => {
    const { errors } = validate('just a string\n');
    expect(errors.some(e => e.check === 'pos-supervisor:TranslationStructure')).toBe(true);
  });
});
