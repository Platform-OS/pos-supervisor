import { describe, it, expect } from 'bun:test';
import {
  getTranslationFilePaths,
  filesAffectedByTranslationFile,
  buildFixOrder,
  computeBlockingFiles,
} from '../../src/tools/analyze-project.js';

const DIR = '/project';

// ---------------------------------------------------------------------------
// getTranslationFilePaths
// ---------------------------------------------------------------------------

describe('getTranslationFilePaths', () => {
  it('returns empty array when no translations in projectMap', () => {
    expect(getTranslationFilePaths({})).toEqual([]);
    expect(getTranslationFilePaths({ translations: {} })).toEqual([]);
  });

  it('maps locale keys to app/translations/<locale>.yml paths', () => {
    const projectMap = { translations: { en: {}, de: {}, fr: {} } };
    const result = getTranslationFilePaths(projectMap);
    expect(result).toHaveLength(3);
    expect(result).toContain('app/translations/en.yml');
    expect(result).toContain('app/translations/de.yml');
    expect(result).toContain('app/translations/fr.yml');
  });

  it('handles single locale', () => {
    const result = getTranslationFilePaths({ translations: { en: {} } });
    expect(result).toEqual(['app/translations/en.yml']);
  });
});

// ---------------------------------------------------------------------------
// filesAffectedByTranslationFile
// ---------------------------------------------------------------------------

describe('filesAffectedByTranslationFile', () => {
  it('returns empty set for unknown locale path', () => {
    const result = filesAffectedByTranslationFile('app/translations/.yml', {});
    expect(result.size).toBe(0);
  });

  it('returns empty set when no files use translation keys', () => {
    const projectMap = {
      pages: { show: { path: 'app/views/pages/show.html.liquid', translation_keys: [] } },
      partials: {},
    };
    const result = filesAffectedByTranslationFile('app/translations/en.yml', projectMap);
    expect(result.size).toBe(0);
  });

  it('includes files that have translation_keys', () => {
    const projectMap = {
      pages: {
        show: { path: 'app/views/pages/show.html.liquid', translation_keys: ['app.hello'] },
      },
      partials: {
        header: { path: 'app/views/partials/header.liquid', translation_keys: ['app.nav.home'] },
        footer: { path: 'app/views/partials/footer.liquid', translation_keys: [] },
      },
      commands: {},
      queries: {},
    };
    const result = filesAffectedByTranslationFile('app/translations/en.yml', projectMap);
    expect(result.has('app/views/pages/show.html.liquid')).toBe(true);
    expect(result.has('app/views/partials/header.liquid')).toBe(true);
    expect(result.has('app/views/partials/footer.liquid')).toBe(false);
  });

  it('includes commands and queries that use translation keys', () => {
    const projectMap = {
      pages: {},
      partials: {},
      commands: {
        'app/lib/commands/create.liquid': {
          path: 'app/lib/commands/create.liquid',
          translation_keys: ['app.success'],
        },
      },
      queries: {
        'app/lib/queries/search.liquid': {
          path: 'app/lib/queries/search.liquid',
          translation_keys: ['app.no_results'],
        },
      },
    };
    const result = filesAffectedByTranslationFile('app/translations/en.yml', projectMap);
    expect(result.has('app/lib/commands/create.liquid')).toBe(true);
    expect(result.has('app/lib/queries/search.liquid')).toBe(true);
  });

  it('works for non-en locales', () => {
    const projectMap = {
      pages: { show: { path: 'app/views/pages/show.html.liquid', translation_keys: ['app.hello'] } },
      partials: {},
      commands: {},
      queries: {},
    };
    const result = filesAffectedByTranslationFile('app/translations/de.yml', projectMap);
    expect(result.has('app/views/pages/show.html.liquid')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildFixOrder — translation file scenarios
// ---------------------------------------------------------------------------

function file(path, errors = 1, warnings = 0) {
  return { path, errors, warnings };
}

describe('buildFixOrder — translation files', () => {
  it('includes translation file in fix_order output', () => {
    const files = [
      file('app/translations/en.yml'),
      file('app/views/pages/show.html.liquid'),
    ];
    const projectMap = {
      pages: { show: { path: 'app/views/pages/show.html.liquid', translation_keys: ['app.hello'] } },
      partials: {},
      commands: {},
      queries: {},
    };
    const result = buildFixOrder(files, {}, DIR, projectMap);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.path)).toContain('app/translations/en.yml');
  });

  it('places translation file before dependent liquid files (via translation_keys)', () => {
    const files = [
      file('app/views/pages/show.html.liquid'),
      file('app/translations/en.yml'),
    ];
    const projectMap = {
      pages: { show: { path: 'app/views/pages/show.html.liquid', translation_keys: ['app.hello'] } },
      partials: {},
      commands: {},
      queries: {},
    };
    const result = buildFixOrder(files, {}, DIR, projectMap);
    const paths = result.map(r => r.path);
    expect(paths.indexOf('app/translations/en.yml'))
      .toBeLessThan(paths.indexOf('app/views/pages/show.html.liquid'));
  });

  it('places translation file first when dependency graph has injected TranslationKeyExists edges', () => {
    // Simulates what analyze_project does: inject edges for files with
    // TranslationKeyExists errors so buildFixOrder can place translation file first.
    const files = [
      file('app/views/pages/show.html.liquid'),
      file('app/translations/en.yml'),
    ];
    const depGraph = {
      'app/views/pages/show.html.liquid': {
        depends_on: ['app/translations/en.yml'],
        referenced_by: [],
      },
      'app/translations/en.yml': {
        depends_on: [],
        referenced_by: ['app/views/pages/show.html.liquid'],
      },
    };
    const result = buildFixOrder(files, depGraph, DIR, {});
    expect(result[0].path).toBe('app/translations/en.yml');
    expect(result[0].dependents_with_errors).toBe(1);
  });

  it('counts dependent files with errors in dependents_with_errors', () => {
    const files = [
      file('app/translations/en.yml'),
      file('app/views/pages/a.html.liquid'),
      file('app/views/pages/b.html.liquid'),
    ];
    const projectMap = {
      pages: {
        a: { path: 'app/views/pages/a.html.liquid', translation_keys: ['app.x'] },
        b: { path: 'app/views/pages/b.html.liquid', translation_keys: ['app.y'] },
      },
      partials: {},
      commands: {},
      queries: {},
    };
    const result = buildFixOrder(files, {}, DIR, projectMap);
    const tran = result.find(r => r.path === 'app/translations/en.yml');
    expect(tran.dependents_with_errors).toBe(2);
    expect(tran.reason).toMatch(/Fix first/);
  });

  it('does not include translation dependents without errors', () => {
    // Only translation file has errors; pages have no errors → not in fileResults
    const files = [file('app/translations/en.yml')];
    const projectMap = {
      pages: { show: { path: 'app/views/pages/show.html.liquid', translation_keys: ['app.hello'] } },
      partials: {},
      commands: {},
      queries: {},
    };
    const result = buildFixOrder(files, {}, DIR, projectMap);
    expect(result).toHaveLength(1);
    const tran = result[0];
    expect(tran.dependents_with_errors).toBe(0);
    expect(tran.reason).toBe('No cross-error dependencies');
  });

  it('works when projectMap is undefined (backward compat)', () => {
    const files = [file('app/a.liquid')];
    expect(() => buildFixOrder(files, {}, DIR, undefined)).not.toThrow();
    const result = buildFixOrder(files, {}, DIR, undefined);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// computeBlockingFiles — translation file explicit coverage (Change 1b)
// ---------------------------------------------------------------------------

describe('computeBlockingFiles — translation files', () => {
  const projectMap = { translations: { en: {} } };

  it('picks up translation file errors even when not in fileResults', () => {
    // Simulate: user passed explicit files list without translation files.
    // Translation error still in allResults from pos-cli check.
    const allResults = {
      errors: [
        {
          severity: 'error',
          _filePath: `${DIR}/app/translations/en.yml`,
          check: 'MatchingTranslations',
          message: 'Missing key "app.hello" in en',
        },
      ],
    };
    const result = computeBlockingFiles([], [], allResults, DIR, projectMap);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('app/translations/en.yml');
    expect(result[0].lint_errors).toBe(1);
    expect(result[0].checks).toContain('MatchingTranslations');
  });

  it('does not duplicate translation file already in fileResults', () => {
    // fileResults already has it (default discovery path with Change 1a)
    const fileResults = [{ path: 'app/translations/en.yml', errors: 2, warnings: 0 }];
    const allResults = {
      errors: [
        { severity: 'error', _filePath: `${DIR}/app/translations/en.yml`, check: 'MatchingTranslations', message: 'x' },
      ],
    };
    const result = computeBlockingFiles(fileResults, [], allResults, DIR, projectMap);
    const entries = result.filter(r => r.path === 'app/translations/en.yml');
    expect(entries).toHaveLength(1);
    expect(entries[0].lint_errors).toBe(2); // from fileResults, not allResults
  });

  it('skips translation file when it has no errors in allResults', () => {
    const allResults = { errors: [] };
    const result = computeBlockingFiles([], [], allResults, DIR, projectMap);
    expect(result).toHaveLength(0);
  });

  it('works without projectDir/projectMap (backward compat)', () => {
    const fileResults = [{ path: 'app/a.liquid', errors: 1, warnings: 0 }];
    expect(() => computeBlockingFiles(fileResults, [])).not.toThrow();
    const result = computeBlockingFiles(fileResults, []);
    expect(result).toHaveLength(1);
  });
});
