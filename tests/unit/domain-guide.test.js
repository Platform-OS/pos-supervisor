import { describe, it, expect } from 'bun:test';
import { getDomainFromPath, getDomainHeader, getReference, isValidDomain, isValidSection } from '../../src/core/domain-detector.js';

describe('getDomainFromPath', () => {
  it('detects pages', () => {
    expect(getDomainFromPath('/app/views/pages/index.html.liquid')).toBe('pages');
  });

  it('detects partials', () => {
    expect(getDomainFromPath('/app/views/partials/shared/header.liquid')).toBe('partials');
  });

  it('detects layouts', () => {
    expect(getDomainFromPath('/app/views/layouts/application.liquid')).toBe('layouts');
  });

  it('detects graphql', () => {
    expect(getDomainFromPath('/app/graphql/products/search.graphql')).toBe('graphql');
  });

  it('detects translations', () => {
    expect(getDomainFromPath('/app/translations/en.yml')).toBe('translations');
  });

  it('detects commands', () => {
    expect(getDomainFromPath('/app/lib/commands/users/create.liquid')).toBe('commands');
  });

  it('detects queries', () => {
    expect(getDomainFromPath('/app/lib/queries/users/find.liquid')).toBe('queries');
  });

  it('detects queries under views/partials/lib/queries/', () => {
    expect(getDomainFromPath('/app/views/partials/lib/queries/blog_posts/find.liquid')).toBe('queries');
  });

  it('detects commands under views/partials/lib/commands/', () => {
    expect(getDomainFromPath('/app/views/partials/lib/commands/blog_posts/create.liquid')).toBe('commands');
  });

  it('returns null for unknown paths', () => {
    expect(getDomainFromPath('/some/random/file.txt')).toBeNull();
  });
});

describe('getDomainHeader', () => {
  it('returns header for partials', async () => {
    const header = await getDomainHeader('partials');
    expect(header).toBeDefined();
    expect(header).toContain('partials');
  });

  it('returns null for nonexistent domain', async () => {
    const header = await getDomainHeader('nonexistent');
    expect(header).toBeNull();
  });
});

describe('getReference', () => {
  it('returns gotchas for partials', async () => {
    const content = await getReference('partials', 'gotchas');
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(100);
  });

  it('returns null for nonexistent section', async () => {
    const content = await getReference('partials', 'nonexistent');
    expect(content).toBeNull();
  });
});

describe('isValidDomain / isValidSection', () => {
  it('validates known domains', () => {
    expect(isValidDomain('pages')).toBe(true);
    expect(isValidDomain('partials')).toBe(true);
    expect(isValidDomain('graphql')).toBe(true);
    expect(isValidDomain('fake')).toBe(false);
  });

  it('validates known sections', () => {
    expect(isValidSection('gotchas')).toBe(true);
    expect(isValidSection('patterns')).toBe(true);
    expect(isValidSection('api')).toBe(true);
    expect(isValidSection('fake')).toBe(false);
  });
});
