/**
 * Scaffold generator — produces production-quality platformOS file sets.
 * Templates derived from skills/platformos/references (authoritative patterns).
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { scanModule } from './module-scanner.js';
import { toPosixPath } from './utils.js';

// ── CSS class verification ──────────────────────────────────────────────────
//
// Every CSS class this scaffold writes into generated templates. Validated at
// generation time against the live common-styling scan so a module upgrade that
// drops or renames a class surfaces as a loud error instead of silent rot in
// generated apps (roadmap F-020 residual).
const SCAFFOLD_REQUIRED_CSS_CLASSES = [
  'pos-card',
  'pos-heading-1',
  'pos-button',
  'pos-button-primary',
  'pos-button-small',
  'pos-form',
  'pos-form-simple',
  'pos-table',
  'pos-table-content',
  'pos-table-content-heading',
];

// ── Type mappings ────────────────────────────────────────────────────────────

const TYPE_TO_GQL = {
  string: 'String', text: 'String', integer: 'Int', float: 'Float',
  boolean: 'Boolean', datetime: 'String', array: '[String]',
};

const TYPE_TO_VALUE_KEY = {
  string: 'value', text: 'value', integer: 'value_int', float: 'value_float',
  boolean: 'value_boolean', datetime: 'value', array: 'value_array',
};

const TYPE_TO_ACCESSOR = {
  string: 'property', text: 'property', integer: 'property_int', float: 'property_float',
  boolean: 'property_boolean', datetime: 'property', array: 'property_array',
};

const VALID_TYPES = new Set(Object.keys(TYPE_TO_GQL));

// Types that require at least one non-auth property to produce valid,
// deployable files. crud/api generate schema + create/update mutations;
// command generates a create mutation + build/check pair. Without a
// non-auth field, the create mutation would emit `mutation create()`
// (GraphQL parse error) and the schema YAML would have an empty
// properties list (platformOS schema validation failure).
const PROPERTIES_REQUIRED = new Set(['crud', 'api', 'command']);

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate scaffold files. Optionally writes them to disk.
 * Scans existing project files to adapt templates to project patterns.
 */
export async function generateScaffold(options, projectDir) {
  const { type, name, properties = [], include_translations = true, write = false } = options;
  let { include_authorization = false } = options;

  // Validate scaffold type up-front — before name/property checks — so the
  // agent gets the actionable error first.
  const KNOWN_TYPES = ['crud', 'api', 'command', 'query', 'partial', 'page'];
  if (!KNOWN_TYPES.includes(type)) {
    throw new Error(`Invalid scaffold type "${type}". Valid: ${KNOWN_TYPES.join(', ')}`);
  }

  // Validate name
  if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid name "${name}": must be lowercase snake_case starting with a letter`);
  }

  // Validate properties
  for (const p of properties) {
    if (!p.name || !p.type) {
      throw new Error(`Each property must have name and type`);
    }
    if (!VALID_TYPES.has(p.type)) {
      throw new Error(`Invalid property type "${p.type}". Valid: ${[...VALID_TYPES].join(', ')}`);
    }
    if (p.role !== undefined && p.role !== 'auth') {
      throw new Error(`Invalid property role "${p.role}". Valid: auth`);
    }
  }

  // Types that build schemas + create/update mutations need at least one
  // non-auth property. An empty or auth-only properties array would produce
  // `mutation create()` (GraphQL parse error) and a schema file with no
  // properties (platformOS schema validation failure). Reject loudly with
  // a concrete example instead of emitting broken files.
  if (PROPERTIES_REQUIRED.has(type)) {
    const nonAuthCount = properties.filter(p => !isAuthField(p)).length;
    if (properties.length === 0 || nonAuthCount === 0) {
      const reason = properties.length === 0
        ? 'properties array is missing or empty'
        : 'all properties are role:auth (server-managed) — at least one user-supplied field is required';
      throw new Error(
        `${type} scaffold requires at least one non-auth property (${reason}). ` +
        `Example: { type: "${type}", name: "${name}", properties: [{ name: "title", type: "string" }, { name: "body", type: "text" }] }. ` +
        `Without non-auth properties the generated schema would be empty and the create mutation would be invalid GraphQL.`
      );
    }
  }

  const notes = [];

  // Auto-upgrade canonical ownership field names to role:auth when
  // include_authorization is enabled. Without this, an agent that adds
  // `{ name: 'user_id', type: 'string' }` — with no role: 'auth' — produces
  // a form that lets any logged-in user spoof any user_id (ownership hole)
  // AND a build command that blindly copies `object.user_id` from the form
  // payload instead of stamping it from `context.current_user.id`. The fix
  // is structural: promote the field to role:auth so every downstream
  // template (form, build, update GQL, search filter, ownership guards)
  // handles it consistently. If an agent genuinely wants a plain
  // user-editable field, they can rename it (e.g. `user_name`).
  const OWNER_FIELD_NAMES = new Set(['user_id', 'owner_id', 'author_id', 'created_by']);
  const autoUpgraded = [];
  if (include_authorization) {
    for (const p of properties) {
      if (OWNER_FIELD_NAMES.has(p.name) && p.role !== 'auth') {
        p.role = 'auth';
        autoUpgraded.push(p.name);
      }
    }
  }
  if (autoUpgraded.length > 0) {
    notes.push(
      `Auto-upgraded to role:auth (server-managed ownership): ${autoUpgraded.join(', ')}. ` +
      `These fields are excluded from the form, stamped server-side from ` +
      `context.current_user.id on create, and used to filter search results + ` +
      `gate update/delete to the record's owner. If you wanted a plain ` +
      `user-editable field, rename it (e.g. user_name) and re-run scaffold.`
    );
  }

  // Auth-role fields require an authenticated user — auto-enable authorization.
  // This must run AFTER auto-upgrade so a promoted user_id flips authorization on.
  const hasAuthFields = properties.some(p => p.role === 'auth');
  if (hasAuthFields && !include_authorization) {
    include_authorization = true;
    notes.push('Authorization automatically enabled: auth-role properties require an authenticated user (context.current_user.id).');
  }

  // Verify scaffold-authored CSS classes against the live common-styling scan.
  // When common-styling is installed and a class we bake into templates no longer
  // exists, fail fast with a concrete error — the agent should either upgrade
  // the scaffold or downgrade the module, not ship invisible rot.
  // When common-styling is not installed the check is skipped (scaffold is still
  // useful in no-modules projects) and a note is added so the agent knows.
  if (type === 'crud' && projectDir) {
    try {
      const csScan = await scanModule(projectDir, 'common-styling');
      if (!csScan.error && Array.isArray(csScan.css_classes) && csScan.css_classes.length > 0) {
        const published = new Set(csScan.css_classes);
        const missing = SCAFFOLD_REQUIRED_CSS_CLASSES.filter(c => !published.has(c));
        if (missing.length > 0) {
          throw new Error(
            `Scaffold CSS class verification failed. Missing from common-styling: ${missing.join(', ')}. ` +
            `The scaffold templates hard-code these classes. Either upgrade the scaffold (src/core/scaffold-generator.js ` +
            `SCAFFOLD_REQUIRED_CSS_CLASSES) to match the installed common-styling version, or pin an older ` +
            `common-styling release. This check prevents silently shipping invisible/broken styles.`
          );
        }
      } else if (csScan.error) {
        notes.push('common-styling module not installed — scaffold CSS classes (feature-grid, card, pos-heading-1) cannot be verified against a live module.');
      }
    } catch (e) {
      // Re-throw verification failures — this is the whole point of the check.
      if (/Scaffold CSS class verification failed/.test(e.message)) throw e;
      // Any other error (scan crash, filesystem issue) is non-fatal — note it.
      notes.push(`common-styling scan failed (${e.message}); CSS class verification skipped.`);
    }
  }

  // Detect existing project patterns to adapt templates
  const patterns = await detectProjectPatterns(projectDir, type);
  if (patterns.assignStyle === 'parse_json' || patterns.assignStyle === 'hash_assign') {
    notes.push(`Existing project uses deprecated ${patterns.assignStyle} syntax. Scaffold generates modern syntax. Consider migrating existing files.`);
  }

  const plural = pluralize(name);
  const opts = { include_authorization, include_translations, patterns };

  let files, creation_order;

  switch (type) {
    case 'crud':
      ({ files, creation_order } = generateCrud(name, plural, properties, opts, projectDir));
      break;
    case 'api':
      ({ files, creation_order } = generateApi(name, plural, properties, opts));
      break;
    case 'command':
      ({ files, creation_order } = generateCommandScaffold(name, plural, properties));
      break;
    case 'query':
      ({ files, creation_order } = generateQueryScaffold(name, plural, properties));
      break;
    case 'partial':
      ({ files, creation_order } = generatePartialScaffold(name, properties));
      break;
    case 'page':
      ({ files, creation_order } = generatePageScaffold(name, plural));
      break;
    default:
      throw new Error(`Invalid scaffold type "${type}". Valid: crud, api, command, query, partial, page`);
  }

  // Detect conflicts. Files with mergeStrategy are not conflicts — their
  // content already incorporates what is on disk.
  const conflicts = [];
  if (projectDir) {
    for (const f of files) {
      if (f.mergeStrategy) continue;
      const abs = join(projectDir, f.path);
      if (existsSync(abs)) {
        conflicts.push({ path: f.path, reason: 'file already exists' });
      }
    }
  }

  // Write files to disk if requested. Merge-strategy files always write
  // (they replace the on-disk file with its merged successor).
  const written = [];
  const skipped = [];
  if (write && projectDir) {
    const conflictPaths = new Set(conflicts.map(c => c.path));
    for (const f of files) {
      if (!f.mergeStrategy && conflictPaths.has(f.path)) {
        skipped.push(f.path);
        continue;
      }
      const abs = join(projectDir, f.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content, 'utf8');
      written.push(f.path);
    }
  }

  const result = {
    files,
    creation_order,
    summary: write
      ? `Wrote ${written.length} files for ${plural} ${type}${skipped.length > 0 ? ` (${skipped.length} skipped — already exist)` : ''}`
      : `Generated ${files.length} files for ${plural} ${type}`,
    conflicts,
    // Structured field that makes the domain_guide workflow inescapable:
    // every scaffold response enumerates the domain_guide calls the agent
    // MUST make before drafting or writing files in this plan. Agents react
    // reliably to structured lists; prose advice is ignored. See roadmap F-017.
    consult_before_writing: buildConsultList(type, properties, { include_translations }),
    ...(notes.length > 0 ? { notes } : {}),
    ...(patterns.adapted_from.length > 0 ? { adapted_from: patterns.adapted_from } : {}),
  };

  if (write) {
    result.written = written;
    result.skipped = skipped;
  } else {
    result._instructions = 'WRITE EACH FILE EXACTLY AS-IS. This is pre-validated, production-quality code. Do NOT modify, rephrase, or rewrite any content. Write files in the order specified by creation_order. When validating with validate_code, pass remaining file paths as pending_files to suppress false-positive MissingPartial warnings.';
  }

  return result;
}

/**
 * Enumerate the domain_guide calls an agent MUST make before drafting or
 * writing files for this scaffold. Every entry is a structured object, not
 * a prose sentence, because agents act reliably on structured fields and
 * ignore prose advice in tool responses.
 *
 * Rules are mechanical:
 *   - crud/api always touch schema, graphql, commands, queries.
 *   - crud also touches pages, partials, forms.
 *   - include_translations:true adds translations.
 *   - any property with role:auth adds authentication (wrong auth URLs and
 *     ownership patterns are the most common class of platformOS bug).
 *   - command/query/partial/page scaffolds add only the domain they target.
 */
function buildConsultList(type, properties, { include_translations }) {
  const domains = new Map(); // Map preserves insertion order for deterministic output.
  const add = (domain, reason) => {
    if (!domains.has(domain)) domains.set(domain, reason);
  };

  if (type === 'crud' || type === 'api') {
    add('schema',   'Scaffold defines a schema YAML file');
    add('graphql',  'Scaffold defines 5 GraphQL ops (search, find, create, update, delete)');
    add('commands', 'Scaffold defines create/update/delete commands with build/check phases');
    add('queries',  'Scaffold defines search/find queries');
  }
  if (type === 'crud') {
    add('pages',    'Scaffold defines 7 pages (index/show/new/edit/create/update/delete)');
    add('partials', 'Scaffold defines 6 partials (index/show/new/edit/form/empty_state)');
    add('forms',    'Scaffold generates a form partial with error handling');
  }
  if (type === 'command') add('commands', 'Scaffold defines a command with build/check phases');
  if (type === 'query')   add('queries',  'Scaffold defines a query wrapper');
  if (type === 'partial') add('partials', 'Scaffold defines a partial');
  if (type === 'page')    add('pages',    'Scaffold defines a page');

  if (include_translations && type !== 'partial' && type !== 'page') {
    add('translations', 'Scaffold generates translation keys — you must understand locale conventions before writing');
  }

  const hasAuth = properties.some(p => p.role === 'auth');
  if (hasAuth) {
    add('authentication', 'Auth-role field detected — ownership checks, correct /sessions/new and /users/new URLs, and current_user patterns are mandatory');
  }

  return [...domains].map(([domain, reason]) => ({
    domain,
    call:   `domain_guide(domain: '${domain}')`,
    reason,
  }));
}

// ── Type-specific generators ─────────────────────────────────────────────────

function generateCrud(name, plural, properties, opts, projectDir) {
  const files = [];

  // Config & Layout — only include if the project doesn't have them yet
  if (!projectDir || !existsSync(join(projectDir, 'app/config.yml'))) {
    files.push({ path: `app/config.yml`, content: configYml(), domain: 'config' });
  }
  if (!projectDir || (
    !existsSync(join(projectDir, 'app/views/layouts/application.liquid')) &&
    !existsSync(join(projectDir, 'app/views/layouts/application.html.liquid'))
  )) {
    files.push({ path: `app/views/layouts/application.liquid`, content: layoutLiquid(), domain: 'layout' });
  }

  files.push(
    // Schema
    { path: `app/schema/${name}.yml`, content: schemaYml(name, properties), domain: 'schema' },
    // GraphQL
    { path: `app/graphql/${plural}/search.graphql`, content: searchGql(name, properties), domain: 'graphql' },
    { path: `app/graphql/${plural}/find.graphql`, content: findGql(name, properties), domain: 'graphql' },
    { path: `app/graphql/${plural}/create.graphql`, content: createGql(name, properties), domain: 'graphql' },
    { path: `app/graphql/${plural}/update.graphql`, content: updateGql(name, properties), domain: 'graphql' },
    { path: `app/graphql/${plural}/delete.graphql`, content: deleteGql(name), domain: 'graphql' },
    // Queries
    { path: `app/lib/queries/${plural}/search.liquid`, content: searchQuery(plural, properties), domain: 'queries' },
    { path: `app/lib/queries/${plural}/find.liquid`, content: findQuery(plural), domain: 'queries' },
    // Commands (multi-file: main + build + check)
    { path: `app/lib/commands/${plural}/create.liquid`, content: createCmd(plural), domain: 'commands' },
    { path: `app/lib/commands/${plural}/create/build.liquid`, content: createBuildCmd(properties), domain: 'commands' },
    { path: `app/lib/commands/${plural}/create/check.liquid`, content: createCheckCmd(plural, properties), domain: 'commands' },
    { path: `app/lib/commands/${plural}/update.liquid`, content: updateCmd(plural), domain: 'commands' },
    { path: `app/lib/commands/${plural}/update/build.liquid`, content: updateBuildCmd(properties), domain: 'commands' },
    { path: `app/lib/commands/${plural}/update/check.liquid`, content: updateCheckCmd(plural, properties), domain: 'commands' },
    { path: `app/lib/commands/${plural}/delete.liquid`, content: deleteCmd(plural), domain: 'commands' },
    { path: `app/lib/commands/${plural}/delete/check.liquid`, content: deleteCheckCmd(), domain: 'commands' },
    // Partials
    { path: `app/views/partials/${plural}/index.liquid`, content: indexPartial(plural, name, properties, opts), domain: 'partials' },
    { path: `app/views/partials/${plural}/show.liquid`, content: showPartial(plural, properties, opts), domain: 'partials' },
    { path: `app/views/partials/${plural}/new.liquid`, content: newPartial(plural, opts), domain: 'partials' },
    { path: `app/views/partials/${plural}/edit.liquid`, content: editPartial(plural, opts), domain: 'partials' },
    { path: `app/views/partials/${plural}/form.liquid`, content: formPartial(plural, name, properties, opts), domain: 'partials' },
    { path: `app/views/partials/${plural}/empty_state.liquid`, content: emptyStatePartial(plural, opts), domain: 'partials' },
    // Pages
    { path: `app/views/pages/${plural}/index.html.liquid`, content: indexPage(plural), domain: 'pages' },
    { path: `app/views/pages/${plural}/show.html.liquid`, content: showPage(plural, properties, opts), domain: 'pages' },
    { path: `app/views/pages/${plural}/new.html.liquid`, content: newPage(plural), domain: 'pages' },
    { path: `app/views/pages/${plural}/edit.html.liquid`, content: editPage(plural), domain: 'pages' },
    { path: `app/views/pages/${plural}/create.html.liquid`, content: createPage(plural, name, properties, opts), domain: 'pages' },
    { path: `app/views/pages/${plural}/update.html.liquid`, content: updatePage(plural, name, properties, opts), domain: 'pages' },
    { path: `app/views/pages/${plural}/delete.html.liquid`, content: deletePage(plural, properties, opts), domain: 'pages' },
  );

  if (opts.include_translations) {
    // Convention is a single `app/translations/<locale>.yml` per locale. We
    // merge the scaffold's keys into any existing en.yml on disk so the agent
    // never has to choose between "write new file" and "preserve my edits".
    // `existed` lets normalizeScaffoldInput set action='update' instead of
    // 'create', and `mergeStrategy` tells the write loop to skip the
    // "already exists" conflict — the content we emit is already the merged
    // result.
    const { content: translationsContent, existed: translationsExisted } =
      buildMergedTranslations(projectDir, 'en', plural, name, properties);
    files.push({
      path: `app/translations/en.yml`,
      content: translationsContent,
      domain: 'translations',
      mergeStrategy: 'deep-merge',
      existed: translationsExisted,
    });
  }

  const creation_order = ['config', 'schema', 'graphql', 'queries', 'commands', 'partials', 'pages'];
  if (opts.include_translations) creation_order.push('translations');

  return { files, creation_order };
}

function generateApi(name, plural, properties, opts) {
  const files = [
    { path: `app/schema/${name}.yml`, content: schemaYml(name, properties), domain: 'schema' },
    { path: `app/graphql/${plural}/search.graphql`, content: searchGql(name, properties), domain: 'graphql' },
    { path: `app/graphql/${plural}/find.graphql`, content: findGql(name, properties), domain: 'graphql' },
    { path: `app/graphql/${plural}/create.graphql`, content: createGql(name, properties), domain: 'graphql' },
    { path: `app/graphql/${plural}/update.graphql`, content: updateGql(name, properties), domain: 'graphql' },
    { path: `app/graphql/${plural}/delete.graphql`, content: deleteGql(name), domain: 'graphql' },
    { path: `app/lib/queries/${plural}/search.liquid`, content: searchQuery(plural, properties), domain: 'queries' },
    { path: `app/lib/queries/${plural}/find.liquid`, content: findQuery(plural), domain: 'queries' },
    { path: `app/lib/commands/${plural}/create.liquid`, content: createCmd(plural), domain: 'commands' },
    { path: `app/lib/commands/${plural}/create/build.liquid`, content: createBuildCmd(properties), domain: 'commands' },
    { path: `app/lib/commands/${plural}/create/check.liquid`, content: createCheckCmd(plural, properties), domain: 'commands' },
    { path: `app/lib/commands/${plural}/update.liquid`, content: updateCmd(plural), domain: 'commands' },
    { path: `app/lib/commands/${plural}/update/build.liquid`, content: updateBuildCmd(properties), domain: 'commands' },
    { path: `app/lib/commands/${plural}/update/check.liquid`, content: updateCheckCmd(plural, properties), domain: 'commands' },
    { path: `app/lib/commands/${plural}/delete.liquid`, content: deleteCmd(plural), domain: 'commands' },
    { path: `app/lib/commands/${plural}/delete/check.liquid`, content: deleteCheckCmd(), domain: 'commands' },
  ];

  return { files, creation_order: ['schema', 'graphql', 'queries', 'commands'] };
}

function generateCommandScaffold(name, plural, properties) {
  const files = [
    { path: `app/graphql/${plural}/create.graphql`, content: createGql(name, properties), domain: 'graphql' },
    { path: `app/lib/commands/${plural}/create.liquid`, content: createCmd(plural), domain: 'commands' },
    { path: `app/lib/commands/${plural}/create/build.liquid`, content: createBuildCmd(properties), domain: 'commands' },
    { path: `app/lib/commands/${plural}/create/check.liquid`, content: createCheckCmd(plural, properties), domain: 'commands' },
  ];

  return { files, creation_order: ['graphql', 'commands'] };
}

function generateQueryScaffold(name, plural, properties) {
  const files = [
    { path: `app/graphql/${plural}/search.graphql`, content: searchGql(name, properties), domain: 'graphql' },
    { path: `app/lib/queries/${plural}/search.liquid`, content: searchQuery(plural, properties), domain: 'queries' },
  ];

  return { files, creation_order: ['graphql', 'queries'] };
}

function generatePartialScaffold(name, properties) {
  const params = properties.map(p => `  @param ${p.name} {${docType(p.type)}} - ${titleCase(p.name).toLowerCase()}`).join('\n');
  const content = `{% doc %}\n${params}\n{% enddoc %}\n`;
  const files = [
    { path: `app/views/partials/${name}.liquid`, content, domain: 'partials' },
  ];

  return { files, creation_order: ['partials'] };
}

function generatePageScaffold(name, plural) {
  const content = `---\nslug: ${plural}\n---\n`;
  const files = [
    { path: `app/views/pages/${plural}/index.html.liquid`, content, domain: 'pages' },
  ];

  return { files, creation_order: ['pages'] };
}

// ── Layout template ─────────────────────────────────────────────────────────

function layoutLiquid() {
  return `<!DOCTYPE html>
<html lang="en" class="pos-app">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ context.page.metadata.title | default: 'App' }}</title>
  {% render 'modules/common-styling/init', reset: true %}
</head>
<body>
  {{ content_for_layout }}
  {% theme_render_rc 'modules/common-styling/toasts' %}
</body>
</html>
`;
}

// ── Config template ─────────────────────────────────────────────────────────

function configYml() {
  return `escape_output_instead_of_sanitize: true
graphql_argument_type_mismatch_mode: error
liquid_add_old_variables: false
liquid_check_mode: error
liquid_raise_mode: true
require_table_for_record_delete_mutation: true
safe_translate: true
skip_elasticsearch: true
slug_exact_match: true
string_interpolation: true
sync_assets: true
sync_translations: true
websockets_require_csrf_token: true
high_performance_sql_filtering: true
`;
}

// ── Schema template ──────────────────────────────────────────────────────────

function schemaYml(name, properties) {
  if (!properties || properties.length === 0) {
    throw new Error(`schemaYml: cannot generate schema "${name}" with zero properties — platformOS schema validation rejects empty property lists`);
  }
  const lines = properties.map(p => `  - name: ${p.name}\n    type: ${p.type}`);
  return `name: ${name}\nproperties:\n${lines.join('\n')}\n`;
}

// ── GraphQL templates ────────────────────────────────────────────────────────

function searchGql(tableName, properties) {
  const fields = properties.map(p =>
    `      ${p.name}: ${TYPE_TO_ACCESSOR[p.type]}(name: "${p.name}")`
  ).join('\n');

  // When the resource has a role:auth property, search filters by it so
  // users only ever see their own records. The Liquid wrapper (searchQuery)
  // supplies the value from context.current_user.id.
  const authProp = properties.find(p => isAuthField(p));
  const paramDecl = authProp
    ? `$page: Int = 1, $limit: Int = 20, $${authProp.name}: ${TYPE_TO_GQL[authProp.type]}!`
    : `$page: Int = 1, $limit: Int = 20`;
  const ownerFilter = authProp
    ? `\n      properties: [{ name: "${authProp.name}", ${TYPE_TO_VALUE_KEY[authProp.type]}: $${authProp.name} }]`
    : '';

  return `query search(${paramDecl}) {
  records(
    per_page: $limit
    page: $page
    filter: {
      table: { value: "${tableName}" }${ownerFilter}
    }
    sort: [{ created_at: { order: DESC } }]
  ) {
    total_entries
    total_pages
    has_previous_page
    has_next_page
    results {
      id
      created_at
      updated_at
      table
${fields}
    }
  }
}
`;
}

function findGql(tableName, properties) {
  const fields = properties.map(p =>
    `      ${p.name}: ${TYPE_TO_ACCESSOR[p.type]}(name: "${p.name}")`
  ).join('\n');

  return `query find($id: ID!) {
  records(
    per_page: 1
    filter: {
      id: { value: $id }
      table: { value: "${tableName}" }
    }
  ) {
    results {
      id
      created_at
      updated_at
      table
${fields}
    }
  }
}
`;
}

function createGql(tableName, properties) {
  if (!properties || properties.length === 0) {
    throw new Error(`createGql: cannot generate create mutation for "${tableName}" with zero properties — GraphQL rejects empty argument lists (\`mutation create()\` is a parse error)`);
  }

  const params = properties.map(p =>
    `$${p.name}: ${TYPE_TO_GQL[p.type]}`
  ).join(', ');

  const props = properties.map(p =>
    `        { name: "${p.name}", ${TYPE_TO_VALUE_KEY[p.type]}: $${p.name} }`
  ).join('\n');

  const fields = properties.map(p =>
    `    ${p.name}: ${TYPE_TO_ACCESSOR[p.type]}(name: "${p.name}")`
  ).join('\n');

  return `mutation create(${params}) {
  record: record_create(
    record: {
      table: "${tableName}"
      properties: [
${props}
      ]
    }
  ) {
    id
    created_at
${fields}
  }
}
`;
}

function updateGql(tableName, properties) {
  // Auth-role fields are set once on create (by build command) and never updated
  const mutableProps = properties.filter(p => !isAuthField(p));
  if (mutableProps.length === 0) {
    throw new Error(`updateGql: cannot generate update mutation for "${tableName}" with zero non-auth properties — there are no fields a client could update`);
  }

  const params = ['$id: ID!']
    .concat(mutableProps.map(p => `$${p.name}: ${TYPE_TO_GQL[p.type]}`))
    .join(', ');

  const props = mutableProps.map(p =>
    `        { name: "${p.name}", ${TYPE_TO_VALUE_KEY[p.type]}: $${p.name} }`
  ).join('\n');

  // All fields (including auth) readable in return
  const fields = properties.map(p =>
    `    ${p.name}: ${TYPE_TO_ACCESSOR[p.type]}(name: "${p.name}")`
  ).join('\n');

  return `mutation update(${params}) {
  record: record_update(
    id: $id
    record: {
      table: "${tableName}"
      properties: [
${props}
      ]
    }
  ) {
    id
    updated_at
${fields}
  }
}
`;
}

function deleteGql(tableName) {
  return `mutation delete($id: ID!) {
  record: record_delete(
    table: "${tableName}"
    id: $id
  ) {
    id
  }
}
`;
}

// ── Query templates (Liquid wrappers around GraphQL) ─────────────────────────

function searchQuery(plural, properties) {
  const authProp = properties?.find(p => isAuthField(p));
  // Ownership filter: pass current_user.id so the GraphQL side constrains
  // results to the caller. An anonymous visitor has no id, so we short-circuit
  // with an empty record set rather than issuing a query with a null required
  // variable (which would GraphQL-error). The index page itself also guards —
  // this branch is belt-and-braces for any future caller of the query.
  const body = authProp
    ? `  assign page = page | default: 1
  assign limit = limit | default: 20
  if context.current_user.id
    graphql result = '${plural}/search', page: page, limit: limit, ${authProp.name}: context.current_user.id
    return result.records
  else
    assign empty_result = '{"results":[],"total_entries":0,"total_pages":0,"has_previous_page":false,"has_next_page":false}' | parse_json
    return empty_result
  endif`
    : `  assign page = page | default: 1
  assign limit = limit | default: 20
  graphql result = '${plural}/search', page: page, limit: limit
  return result.records`;

  return `{% doc %}
  @param [page] {number} - page number (defaults to 1 via the | default filter)
  @param [limit] {number} - items per page (defaults to 20 via the | default filter)
{% enddoc %}

{% liquid
${body}
%}
`;
}

function findQuery(plural) {
  return `{% doc %}
  @param id {string} - record ID
{% enddoc %}

{% liquid
  graphql result = '${plural}/find', id: id
  assign item = result.records.results.first
  return item
%}
`;
}

// ── Command templates (multi-file: main + build + check) ─────────────────────

// Main orchestrator: build → check → execute
function createCmd(plural) {
  return `{% doc %}
  @param object {object} - form params
{% enddoc %}

{% liquid
  function object = 'commands/${plural}/create/build', object: object
  function object = 'commands/${plural}/create/check', object: object

  if object.valid
    function object = 'modules/core/commands/execute', mutation_name: '${plural}/create', selection: 'record', object: object
  endif

  return object
%}
`;
}

function createBuildCmd(properties) {
  if (!properties || properties.length === 0) {
    throw new Error(`createBuildCmd: cannot generate build command with zero properties — there would be nothing to assign onto the object`);
  }

  const assignFields = properties.map(p =>
    isAuthField(p)
      ? `  assign object['${p.name}'] = context.current_user.id`
      : `  assign object['${p.name}'] = object.${p.name}`
  ).join('\n');

  return `{% doc %}
  @param object {object} - form params to reshape
{% enddoc %}

{% liquid
${assignFields}

  return object
%}
`;
}

function createCheckCmd(plural, properties) {
  // Auth-role fields are server-assigned — no user validation needed
  const nonAuth = properties.filter(p => !isAuthField(p));
  if (nonAuth.length === 0) {
    throw new Error(`createCheckCmd: cannot generate check command for "${plural}" with zero non-auth properties — there would be nothing to validate`);
  }
  const validationLines = nonAuth.map(p =>
    `  function c = 'modules/core/validations/presence', c: c, object: object, field_name: '${p.name}'`
  ).join('\n');

  return `{% doc %}
  @param object {object} - object to validate
{% enddoc %}

{% liquid
  assign c = { "errors": {}, "valid": true }
${validationLines}

  assign object = object | hash_merge: valid: c.valid, errors: c.errors

  return object
%}
`;
}

function updateCmd(plural) {
  return `{% doc %}
  @param object {object} - form params with id
{% enddoc %}

{% liquid
  function object = 'commands/${plural}/update/build', object: object
  function object = 'commands/${plural}/update/check', object: object

  if object.valid
    function object = 'modules/core/commands/execute', mutation_name: '${plural}/update', selection: 'record', object: object
  endif

  return object
%}
`;
}

function updateBuildCmd(properties) {
  // Auth-role fields are ownership fields set on create — never reassigned on update
  const assignFields = [
    `  assign object['id'] = object.id`,
    ...properties.filter(p => !isAuthField(p)).map(p => `  assign object['${p.name}'] = object.${p.name}`),
  ].join('\n');

  return `{% doc %}
  @param object {object} - form params to reshape
{% enddoc %}

{% liquid
${assignFields}

  return object
%}
`;
}

function updateCheckCmd(plural, properties) {
  // Auth-role fields are server-assigned ownership fields — not validated on update
  const validationLines = [
    `  function c = 'modules/core/validations/presence', c: c, object: object, field_name: 'id'`,
    ...properties.filter(p => !isAuthField(p)).map(p =>
      `  function c = 'modules/core/validations/presence', c: c, object: object, field_name: '${p.name}'`
    ),
  ].join('\n');

  return `{% doc %}
  @param object {object} - object to validate
{% enddoc %}

{% liquid
  assign c = { "errors": {}, "valid": true }
${validationLines}

  assign object = object | hash_merge: valid: c.valid, errors: c.errors

  return object
%}
`;
}

function deleteCmd(plural) {
  return `{% doc %}
  @param object {object} - object with id
{% enddoc %}

{% liquid
  function object = 'commands/${plural}/delete/check', object: object

  if object.valid
    function object = 'modules/core/commands/execute', mutation_name: '${plural}/delete', selection: 'record', object: object
  endif

  return object
%}
`;
}

function deleteCheckCmd() {
  return `{% doc %}
  @param object {object} - object to validate
{% enddoc %}

{% liquid
  assign c = { "errors": {}, "valid": true }
  function c = 'modules/core/validations/presence', c: c, object: object, field_name: 'id'

  assign object = object | hash_merge: valid: c.valid, errors: c.errors

  return object
%}
`;
}

// ── Page templates ───────────────────────────────────────────────────────────

function indexPage(plural) {
  return `---
slug: ${plural}
layout: application
---
{% liquid
  function ${plural} = 'queries/${plural}/search', page: context.params.page, limit: 20
  render '${plural}/index', ${plural}: ${plural}
%}
`;
}

function showPage(plural, properties, opts) {
  const authProp = properties?.find(p => isAuthField(p));
  // When there's an auth-role property, the record is per-user: a request
  // for someone else's record must 404 (not 403 — don't leak existence).
  const ownershipBranch = authProp
    ? `  if object.id == null or object.${authProp.name} != context.current_user.id
    response_status 404
  else
    render '${plural}/show', object: object
  endif`
    : `  if object.id
    render '${plural}/show', object: object
  else
    response_status 404
  endif`;

  return `---
slug: ${plural}/:id
layout: application
---
{% liquid
  function object = 'queries/${plural}/find', id: context.params.id
${ownershipBranch}
%}
`;
}

function newPage(plural) {
  return `---
slug: ${plural}/new
layout: application
---
{% liquid
  assign object = {}
  render '${plural}/new', object: object
%}
`;
}

function editPage(plural) {
  return `---
slug: ${plural}/edit
layout: application
---
{% liquid
  function object = 'queries/${plural}/find', id: context.params.id
  render '${plural}/edit', object: object
%}
`;
}

// Inline auth guard used on mutation pages when include_authorization is set.
//
// Why inline (and not can_do_or_unauthorized)?
// The user module's can_do_or_unauthorized consults role_permissions/permissions
// which, in the stock user module, only ships auth/session/user entries —
// NOT `<plural>.create|update|delete`. Calling the helper with an unregistered
// action returns false for every non-superadmin role and the page 403s even
// for a perfectly authenticated request. Seeding the registry is outside the
// scaffold's remit (different projects carry different permission maps), so
// we use the narrower, ALWAYS-correct check: "a logged-in user may mutate
// their own records". Ownership is enforced separately via the authProp check
// below when the resource has a role:auth property.
function authGuard() {
  return `  if context.current_user.id == null
    response_status 403
    break
  endif`;
}

// Ownership guard: the fetched record's auth field must match the caller.
// 404 (not 403) on mismatch — don't leak existence of other users' records.
function ownershipGuard(authProp) {
  return `  if object.id == null or object.${authProp.name} != context.current_user.id
    response_status 404
    break
  endif`;
}

function createPage(plural, name, properties, opts) {
  const authBlock = opts.include_authorization ? authGuard() + '\n' : '';

  return `---
slug: ${plural}
method: post
layout: application
---
{% liquid
${authBlock}  function object = 'commands/${plural}/create', object: context.params.${name}

  if object.valid
    redirect_to '/${plural}'
  else
    render '${plural}/new', object: object
  endif
%}
`;
}

function updatePage(plural, name, properties, opts) {
  const authBlock = opts.include_authorization ? authGuard() + '\n' : '';
  const authProp = properties.find(p => isAuthField(p));
  // When a role:auth property exists, verify the record being updated belongs
  // to the caller BEFORE running the update command. The find lookup also
  // strips `${authProp}` from the incoming form payload so a malicious client
  // can't reassign ownership in flight.
  const ownershipBlock = authProp
    ? `  function existing = 'queries/${plural}/find', id: context.params.${name}.id
  if existing.id == null or existing.${authProp.name} != context.current_user.id
    response_status 404
    break
  endif
`
    : '';

  return `---
slug: ${plural}
method: put
layout: application
---
{% liquid
${authBlock}${ownershipBlock}  function object = 'commands/${plural}/update', object: context.params.${name}

  if object.valid
    redirect_to '/${plural}'
  else
    render '${plural}/edit', object: object
  endif
%}
`;
}

function deletePage(plural, properties, opts) {
  const authBlock = opts.include_authorization ? authGuard() + '\n' : '';
  const authProp = properties?.find(p => isAuthField(p));
  const ownershipBlock = authProp ? ownershipGuard(authProp) + '\n' : '';

  return `---
slug: ${plural}
method: delete
layout: application
---
{% liquid
${authBlock}  function object = 'queries/${plural}/find', id: context.params.id
${ownershipBlock}  function object = 'commands/${plural}/delete', object: object

  if object.valid
    redirect_to '/${plural}'
  else
    redirect_to '/${plural}'
  endif
%}
`;
}

// ── Partial templates ────────────────────────────────────────────────────────

function indexPartial(plural, singularName, properties, opts) {
  const addLabel = opts.include_translations
    ? `{{ 'app.${plural}.list.add' | t }}`
    : `Add ${titleCase(singularName)}`;

  const editLabel = opts.include_translations
    ? `{{ 'app.${plural}.list.edit' | t }}`
    : 'Edit';

  const deleteLabel = opts.include_translations
    ? `{{ 'app.${plural}.list.delete' | t }}`
    : 'Delete';

  // Find a display field (title or name preferred, first non-auth string otherwise)
  const displayProp = properties.find(p => p.name === 'title' || p.name === 'name')
    || properties.find(p => p.type === 'string' && !isAuthField(p));
  const titleField = displayProp ? displayProp.name : 'id';

  // Find an excerpt/description field for card preview
  const excerptProp = properties.find(p =>
    ['excerpt', 'description', 'bio', 'summary'].includes(p.name)
  );
  const excerptBlock = excerptProp
    ? `\n        {% if ${singularName}.${excerptProp.name} %}\n          <p style="color:var(--color-muted); margin-bottom:var(--space-2);">{{ ${singularName}.${excerptProp.name} }}</p>\n        {% endif %}`
    : '';

  // Ownership guard for edit/delete (use auth field if present, else any logged-in user)
  const authProp = properties.find(p => isAuthField(p));
  const ownerOpen = authProp
    ? `{% if context.current_user.id == ${singularName}.${authProp.name} %}`
    : `{% if context.current_user.id %}`;

  return `{% doc %}
  @param ${plural} {object} - query result with results array
{% enddoc %}

{% if context.current_user.id %}
  <div style="margin-block-end:var(--pos-gap-section-section);">
    <a href="/${plural}/new" class="pos-button pos-button-primary">${addLabel}</a>
  </div>
{% endif %}

{% if ${plural}.results.size > 0 %}
  <section class="pos-table">
    <header>
      <div>${titleCase(titleField)}</div>${excerptProp ? `\n      <div>${titleCase(excerptProp.name)}</div>` : ''}
      <div>Actions</div>
    </header>
    <div class="pos-table-content pos-card">
      {% for ${singularName} in ${plural}.results %}
        <ul>
          <li>
            <span class="pos-table-content-heading">${titleCase(titleField)}</span>
            <a href="/${plural}/{{ ${singularName}.id }}">{{ ${singularName}.${titleField} }}</a>
          </li>${excerptProp ? `\n          <li>\n            <span class="pos-table-content-heading">${titleCase(excerptProp.name)}</span>\n            {{ ${singularName}.${excerptProp.name} | truncate: 80 }}\n          </li>` : ''}
          <li>
            <span class="pos-table-content-heading">Actions</span>
            <a href="/${plural}/{{ ${singularName}.id }}" class="pos-button pos-button-small">View</a>
            ${ownerOpen}
              <a href="/${plural}/edit?id={{ ${singularName}.id }}" class="pos-button pos-button-small">${editLabel}</a>
              <form action="/${plural}" method="post" style="display:inline">
                <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
                <input type="hidden" name="_method" value="delete">
                <input type="hidden" name="id" value="{{ ${singularName}.id }}">
                <button type="submit" class="pos-button pos-button-small">${deleteLabel}</button>
              </form>
            {% endif %}
          </li>
        </ul>
      {% endfor %}
    </div>
  </section>
{% else %}
  {% render '${plural}/empty_state' %}
{% endif %}
`;
}

function showPartial(plural, properties, opts) {
  // Use title or name as the heading; fall back to first non-auth string field
  const displayProp = properties.find(p => p.name === 'title' || p.name === 'name')
    || properties.find(p => p.type === 'string' && !isAuthField(p));
  const titleField = displayProp ? displayProp.name : null;

  // Remaining fields (not the display title, not auth fields)
  const bodyProps = properties.filter(p => !isAuthField(p) && p !== displayProp);
  const fieldBlocks = bodyProps.map(p => {
    const label = opts.include_translations
      ? `{{ 'app.${plural}.attr.${p.name}' | t }}`
      : titleCase(p.name);
    return `  <dt class="pos-supplementary">${label}</dt>\n  <dd>{{ object.${p.name} }}</dd>`;
  }).join('\n\n');

  const heading = titleField ? `{{ object.${titleField} }}` : `{{ object.id }}`;

  return `{% doc %}
  @param object {object} - ${plural.replace(/_/g, ' ')} record
{% enddoc %}

<article>
  <h1 class="pos-heading-1">${heading}</h1>

  <dl style="margin-block-start:var(--pos-gap-section-section);">
${fieldBlocks}
  </dl>
</article>
`;
}

function newPartial(plural, opts) {
  const heading = opts.include_translations
    ? `{{ 'app.${plural}.new.new' | t }}`
    : `New ${titleCase(plural.replace(/s$/, ''))}`;

  return `{% doc %}
  @param object {object} - empty object or command result with errors
{% enddoc %}

<section style="max-width:48rem; margin-inline:auto;">
  <h1 class="pos-heading-1">${heading}</h1>
  {% render '${plural}/form', object: object %}
</section>
`;
}

function editPartial(plural, opts) {
  const heading = opts.include_translations
    ? `{{ 'app.${plural}.edit.edit' | t }}`
    : `Edit ${titleCase(plural.replace(/s$/, ''))}`;

  return `{% doc %}
  @param object {object} - record data or command result with errors
{% enddoc %}

<section style="max-width:48rem; margin-inline:auto;">
  <h1 class="pos-heading-1">${heading}</h1>
  {% render '${plural}/form', object: object %}
</section>
`;
}

function formPartial(plural, singularName, properties, opts) {
  // Auth-role fields are server-managed — excluded from forms entirely
  const formProperties = properties.filter(p => !isAuthField(p));

  const fieldBlocks = formProperties.map(p => {
    const label = fieldLabel(plural, p.name, opts);
    const inputName = `${singularName}[${p.name}]`;

    const inputTag = p.type === 'text'
      ? `<textarea name="${inputName}" id="${p.name}" {% render 'modules/common-styling/forms/error_input_handler', errors: object.errors.${p.name}, name: '${p.name}' %}>{{ object.${p.name} }}</textarea>`
      : p.type === 'integer'
      ? `<input type="number" name="${inputName}" id="${p.name}" value="{{ object.${p.name} }}" {% render 'modules/common-styling/forms/error_input_handler', errors: object.errors.${p.name}, name: '${p.name}' %}>`
      : p.type === 'float'
      ? `<input type="number" step="any" name="${inputName}" id="${p.name}" value="{{ object.${p.name} }}" {% render 'modules/common-styling/forms/error_input_handler', errors: object.errors.${p.name}, name: '${p.name}' %}>`
      : p.type === 'boolean'
      ? `<input type="checkbox" name="${inputName}" value="true"{% if object.${p.name} %} checked{% endif %}>`
      : `<input type="text" name="${inputName}" id="${p.name}" value="{{ object.${p.name} }}" {% render 'modules/common-styling/forms/error_input_handler', errors: object.errors.${p.name}, name: '${p.name}' %}>`;

    return `  <fieldset>
    <label for="${p.name}">${label}</label>
    ${inputTag}
    {% render 'modules/common-styling/forms/error_list', errors: object.errors.${p.name}, name: '${p.name}' %}
  </fieldset>`;
  }).join('\n\n');

  const saveLabel = opts.include_translations
    ? `{{ 'app.${plural}.save' | t }}`
    : 'Save';
  const cancelLabel = opts.include_translations
    ? `{{ 'app.${plural}.cancel' | t }}`
    : 'Cancel';

  return `{% doc %}
  @param object {object} - record data or command result with errors
{% enddoc %}

{% liquid
  if object.id
    assign method = 'put'
  else
    assign method = 'post'
  endif
%}

<form action="/${plural}" method="post" class="pos-form pos-form-simple">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <input type="hidden" name="_method" value="{{ method }}">

  {% if object.id %}
    <input type="hidden" name="${singularName}[id]" value="{{ object.id }}">
  {% endif %}

  {% render 'modules/common-styling/forms/error_list', errors: object.errors, name: 'form' %}

${fieldBlocks}

  <fieldset class="pos-form-actions">
    <button type="submit" class="pos-button pos-button-primary">${saveLabel}</button>
    <a href="/${plural}">${cancelLabel}</a>
  </fieldset>
</form>
`;
}

function emptyStatePartial(plural, opts) {
  const msg = opts.include_translations
    ? `{{ 'app.${plural}.list.empty_state' | t }}`
    : `No ${titleCase(plural).toLowerCase()} found.`;
  const linkText = opts.include_translations
    ? `{{ 'app.${plural}.list.add' | t }}`
    : `Add ${titleCase(plural.replace(/s$/, ''))}`;

  return `{% doc %}
  Empty state shown when no ${plural.replace(/_/g, ' ')} exist.
{% enddoc %}

<div class="pos-card" style="text-align:center;">
  <p class="pos-supplementary">${msg}</p>
  {% if context.current_user.id %}
    <a href="/${plural}/new" class="pos-button pos-button-primary">${linkText}</a>
  {% endif %}
</div>
`;
}

// ── Translations template ────────────────────────────────────────────────────

/**
 * Build the translation tree the scaffold contributes for a single resource.
 * Returns the structured object (NOT serialised YAML) so the merger can combine
 * it with any existing keys on disk before serialisation.
 */
function buildScaffoldTranslationTree(plural, singularName, properties) {
  const singular = titleCase(singularName);
  const attr = {};
  for (const p of properties) {
    attr[p.name] = titleCase(p.name);
  }

  return {
    app: {
      [plural]: {
        new: { new: `New ${singular}` },
        edit: { edit: `Edit ${singular}` },
        list: {
          add: `Add ${singular}`,
          empty_state: `You haven't added any ${plural} yet.`,
          edit: 'Edit',
          delete: 'Delete',
        },
        save: 'Save',
        cancel: 'Cancel',
        attr,
      },
    },
  };
}

/**
 * Deep-merge for plain objects. Existing (base) values win over extra values on
 * leaf conflicts so a user's hand-edited translation never gets silently
 * overwritten by a re-scaffold. New branches are added. Non-object leaves are
 * replaced wholesale by the base (or kept from extra if the base doesn't have
 * that key at all). Arrays are not merged — if either side has an array, the
 * base wins to preserve any manual curation.
 */
function deepMergePreservingBase(base, extra) {
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
    return base === undefined ? extra : base;
  }
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    return base === undefined ? extra : base;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (!(key in result)) {
      result[key] = value;
      continue;
    }
    result[key] = deepMergePreservingBase(result[key], value);
  }
  return result;
}

/**
 * Build the (merged) content for `app/translations/<locale>.yml`.
 *
 * - Reads any existing on-disk file; merges the scaffold's keys into it.
 * - Existing keys win on conflicts so manual edits survive re-scaffolds.
 * - Returns `{ content, existed }` so the caller can (a) emit the file and
 *   (b) flag it as an update rather than a create.
 *
 * When `projectDir` is null (pure-function mode) we behave as if the file did
 * not exist — useful for unit tests.
 */
function buildMergedTranslations(projectDir, locale, plural, name, properties) {
  const scaffoldTree = buildScaffoldTranslationTree(plural, name, properties);
  const relPath = `app/translations/${locale}.yml`;
  let existed = false;
  let merged = { [locale]: scaffoldTree };

  if (projectDir) {
    const absPath = join(projectDir, relPath);
    if (existsSync(absPath)) {
      existed = true;
      try {
        const raw = readFileSync(absPath, 'utf8');
        const parsed = yamlLoad(raw);
        if (parsed && typeof parsed === 'object') {
          const existingLocaleTree = parsed[locale] ?? {};
          const mergedLocaleTree = deepMergePreservingBase(existingLocaleTree, scaffoldTree);
          // Preserve other locale roots (pl, de, …) untouched.
          merged = { ...parsed, [locale]: mergedLocaleTree };
        }
      } catch { /* unreadable or invalid YAML — emit the scaffold tree fresh */ }
    }
  }

  const content = yamlDump(merged, { indent: 2, lineWidth: 120, noRefs: true });
  return { content, existed };
}

// ── Pattern detection ────────────────────────────────────────────────────────

/**
 * Detect coding patterns from existing project files of the same domain.
 * Returns a pattern profile that template generators can use to adapt output.
 */
async function detectProjectPatterns(projectDir, type) {
  const profile = {
    authStyle: 'function',      // 'function' (modern) or 'include' (legacy)
    hasErrorHandling: false,    // project uses {% try %}...{% catch %}
    assignStyle: 'bracket',     // 'bracket' (modern) or 'parse_json'/'hash_assign' (deprecated)
    adapted_from: [],
  };

  if (!projectDir) return profile;

  // Find sample files of the same type in the project
  const samplePaths = [];
  const scanDir = (dir, ext) => {
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir, { recursive: true });
      for (const e of entries) {
        if (e.endsWith(ext)) { samplePaths.push(join(dir, e)); if (samplePaths.length >= 3) return; }
      }
    } catch { /* best-effort */ }
  };

  if (type === 'crud' || type === 'api' || type === 'command') {
    scanDir(join(projectDir, 'app/lib/commands'), '.liquid');
  }
  if (type === 'crud' || type === 'query') {
    scanDir(join(projectDir, 'app/lib/queries'), '.liquid');
  }
  if ((type === 'crud' || type === 'page') && samplePaths.length < 3) {
    scanDir(join(projectDir, 'app/views/pages'), '.liquid');
  }

  if (samplePaths.length === 0) return profile;

  // Analyze sample files for patterns
  for (const absPath of samplePaths.slice(0, 3)) {
    try {
      const content = readFileSync(absPath, 'utf8');
      // `absPath` and `projectDir` use native separators; the result feeds
      // `adapted_from` which surfaces in tool output and tests, both of which
      // expect POSIX-style relative paths.
      const relPath = toPosixPath(relative(projectDir, absPath));

      if (/include\s+['"]modules\/user\/helpers\/can_do/.test(content)) {
        profile.authStyle = 'include';
      }
      if (/\{%[-\s]*parse_json\s/.test(content)) {
        profile.assignStyle = 'parse_json';
      }
      if (/\{%[-\s]*hash_assign\s/.test(content)) {
        profile.assignStyle = 'hash_assign';
      }
      if (/\{%[-\s]*try\s/.test(content)) {
        profile.hasErrorHandling = true;
      }

      profile.adapted_from.push(relPath);
    } catch { /* skip unreadable files */ }
  }

  return profile;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Returns true if this property is server-managed via authenticated user
function isAuthField(p) {
  return p.role === 'auth';
}

function pluralize(name) {
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('z') ||
      name.endsWith('ch') || name.endsWith('sh')) {
    return name + 'es';
  }
  if (name.endsWith('y') && !/[aeiou]y$/.test(name)) {
    return name.slice(0, -1) + 'ies';
  }
  return name + 's';
}

function titleCase(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function docType(propertyType) {
  const map = {
    string: 'string', text: 'string', integer: 'number', float: 'number',
    boolean: 'boolean', datetime: 'string', array: 'array',
  };
  return map[propertyType] || 'string';
}

function fieldLabel(plural, propName, opts) {
  if (opts.include_translations) {
    return `{{ 'app.${plural}.attr.${propName}' | t }}`;
  }
  return titleCase(propName);
}
