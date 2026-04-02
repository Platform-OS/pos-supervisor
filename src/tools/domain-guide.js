import { getDomainHeader, getReference, isValidDomain, isValidSection } from '../core/domain-detector.js';

export const domainGuideTool = {
  name: 'domain_guide',
  description: 'Get platformOS domain-specific guidance. Returns gotchas, patterns, API reference, configuration, or advanced topics for a specific domain (pages, partials, graphql, translations, etc.). Use this to learn domain rules BEFORE writing code.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        enum: [
          'pages', 'partials', 'graphql', 'translations', 'layouts', 'commands', 'schema', 'config', 'queries',
          'forms', 'routing', 'authentication', 'sessions', 'assets', 'background-jobs', 'caching',
          'configuration', 'constants', 'deployment', 'migrations', 'testing', 'cli',
          'api-calls', 'emails-sms', 'events-consumers', 'flash-messages',
          'liquid/tags', 'liquid/objects', 'liquid/filters', 'liquid/variables',
          'liquid/types', 'liquid/flow-control', 'liquid/loops'
        ],
        description: 'Domain to get guidance for',
      },
      section: {
        type: 'string',
        enum: ['gotchas', 'patterns', 'api', 'configuration', 'advanced', 'overview'],
        description: 'Section to retrieve. "gotchas" for common mistakes, "patterns" for best practices, "api" for reference, "overview" for introduction. Default: gotchas',
      },
    },
    required: ['domain'],
  },

  createHandler(_ctx) {
    return async (params) => {
      const { domain, section = 'gotchas' } = params;

      if (!isValidDomain(domain)) {
        return { error: `Unknown domain: ${domain}. Valid: pages, partials, graphql, translations, layouts, commands, schema, config, queries` };
      }
      if (!isValidSection(section)) {
        return { error: `Unknown section: ${section}. Valid: gotchas, patterns, api, configuration, advanced, overview` };
      }

      const [header, content] = await Promise.all([
        getDomainHeader(domain),
        getReference(domain, section),
      ]);

      if (!content && !header) {
        return { domain, section, content: `No ${section} documentation found for domain "${domain}".` };
      }

      const parts = [];
      if (header) parts.push(header.trim());
      if (content) parts.push(content.trim());

      return {
        domain,
        section,
        content: parts.join('\n\n'),
      };
    };
  },
};
