import { z } from 'zod';
import { getDomainHeader, getReference, isValidDomain, isValidSection } from '../core/domain-detector.js';
import { ToolError } from '../core/tool-error.js';

export const domainGuideTool = {
  name: 'domain_guide',
  description: `CALL THIS FIRST for any domain you are about to write code in.

Contains mandatory rules, gotchas, auth patterns, and correct URLs that are NOT
in your training data and that differ from Shopify, Rails, and generic Liquid.
Skipping domain_guide is the single most common cause of bugs in platformOS
agent sessions.

MUST be called for every domain in your plan BEFORE calling validate_intent or
writing any file. MUST be called at the point of need when a scaffold response
emits \`consult_before_writing\` — every entry in that list MUST resolve to a
domain_guide call before step 5 of the mandatory workflow.

Returns gotchas (default), patterns, api, configuration, advanced, or overview
for a specific domain. Start with gotchas for any domain you have not previously
consulted in this session.`,
  inputSchema: {
    domain: z.enum([
      'pages', 'partials', 'graphql', 'translations', 'layouts', 'commands', 'schema', 'config', 'queries',
      'forms', 'routing', 'authentication', 'sessions', 'assets', 'background-jobs', 'caching',
      'configuration', 'constants', 'deployment', 'migrations', 'testing', 'cli',
      'api-calls', 'emails-sms', 'events-consumers', 'flash-messages',
      'liquid/tags', 'liquid/objects', 'liquid/filters', 'liquid/variables',
      'liquid/types', 'liquid/flow-control', 'liquid/loops',
      'design-system',
    ]).describe('Domain to get guidance for'),
    section: z.enum(['gotchas', 'patterns', 'api', 'configuration', 'advanced', 'overview']).optional().describe('Section to retrieve. "gotchas" for common mistakes, "patterns" for best practices, "api" for reference, "overview" for introduction. Default: gotchas'),
  },

  createHandler(_ctx) {
    return async (params) => {
      const { domain, section = 'gotchas' } = params;

      if (!isValidDomain(domain)) {
        throw new ToolError(`Unknown domain: ${domain}. Valid: pages, partials, graphql, translations, layouts, commands, schema, config, queries`);
      }
      if (!isValidSection(section)) {
        throw new ToolError(`Unknown section: ${section}. Valid: gotchas, patterns, api, configuration, advanced, overview`);
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
