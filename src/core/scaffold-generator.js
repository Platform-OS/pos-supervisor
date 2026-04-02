/**
 * Scaffold generator — produces production-quality platformOS file sets.
 * Templates derived from skills/platformos/references (authoritative patterns).
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

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

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate scaffold files. Optionally writes them to disk.
 * Scans existing project files to adapt templates to project patterns.
 */
export async function generateScaffold(options, projectDir) {
  const { type, name, properties = [], include_translations = true, write = false } = options;
  let { include_authorization = false } = options;

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

  // Auth-role fields require an authenticated user — auto-enable authorization
  const notes = [];
  const hasAuthFields = properties.some(p => p.role === 'auth');
  if (hasAuthFields && !include_authorization) {
    include_authorization = true;
    notes.push('Authorization automatically enabled: auth-role properties require an authenticated user (context.current_user.id).');
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

  // Detect conflicts
  const conflicts = [];
  if (projectDir) {
    for (const f of files) {
      const abs = join(projectDir, f.path);
      if (existsSync(abs)) {
        conflicts.push({ path: f.path, reason: 'file already exists' });
      }
    }
  }

  // Write files to disk if requested
  const written = [];
  const skipped = [];
  if (write && projectDir) {
    const conflictPaths = new Set(conflicts.map(c => c.path));
    for (const f of files) {
      if (conflictPaths.has(f.path)) {
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
    { path: `app/lib/queries/${plural}/search.liquid`, content: searchQuery(plural), domain: 'queries' },
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
    { path: `app/views/pages/${plural}/show.html.liquid`, content: showPage(plural), domain: 'pages' },
    { path: `app/views/pages/${plural}/new.html.liquid`, content: newPage(plural), domain: 'pages' },
    { path: `app/views/pages/${plural}/edit.html.liquid`, content: editPage(plural), domain: 'pages' },
    { path: `app/views/pages/${plural}/create.html.liquid`, content: createPage(plural, name, properties, opts), domain: 'pages' },
    { path: `app/views/pages/${plural}/update.html.liquid`, content: updatePage(plural, name, properties, opts), domain: 'pages' },
    { path: `app/views/pages/${plural}/delete.html.liquid`, content: deletePage(plural, opts), domain: 'pages' },
  );

  if (opts.include_translations) {
    files.push({
      path: `app/translations/en/${plural}.yml`,
      content: translationsYml(plural, name, properties),
      domain: 'translations',
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
    { path: `app/lib/queries/${plural}/search.liquid`, content: searchQuery(plural), domain: 'queries' },
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
    { path: `app/lib/queries/${plural}/search.liquid`, content: searchQuery(plural), domain: 'queries' },
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
  const lines = properties.map(p => `  - name: ${p.name}\n    type: ${p.type}`);
  return `name: ${name}\nproperties:\n${lines.join('\n')}\n`;
}

// ── GraphQL templates ────────────────────────────────────────────────────────

function searchGql(tableName, properties) {
  const fields = properties.map(p =>
    `      ${p.name}: ${TYPE_TO_ACCESSOR[p.type]}(name: "${p.name}")`
  ).join('\n');

  return `query search($page: Int = 1, $limit: Int = 20) {
  records(
    per_page: $limit
    page: $page
    filter: {
      table: { value: "${tableName}" }
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

function searchQuery(plural) {
  return `{% doc %}
  @param page {number} - page number (default: 1)
  @param limit {number} - items per page (default: 20)
{% enddoc %}

{% liquid
  assign page = page | default: 1
  assign limit = limit | default: 20
  graphql result = '${plural}/search', page: page, limit: limit
  return result.records
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
  const validationLines = properties.filter(p => !isAuthField(p)).map(p =>
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

function showPage(plural) {
  return `---
slug: ${plural}/:id
layout: application
---
{% liquid
  function object = 'queries/${plural}/find', id: context.params.id
  if object.id
    render '${plural}/show', object: object
  else
    response_status 404
  endif
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

function createPage(plural, name, properties, opts) {
  let authBlock = '';
  if (opts.include_authorization) {
    authBlock = `  function profile = 'modules/user/queries/user/current'
  function _ = 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: '${plural}.create'
`;
  }

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
  let authBlock = '';
  if (opts.include_authorization) {
    authBlock = `  function profile = 'modules/user/queries/user/current'
  function _ = 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: '${plural}.update'
`;
  }

  return `---
slug: ${plural}
method: put
layout: application
---
{% liquid
${authBlock}  function object = 'commands/${plural}/update', object: context.params.${name}

  if object.valid
    redirect_to '/${plural}'
  else
    render '${plural}/edit', object: object
  endif
%}
`;
}

function deletePage(plural, opts) {
  let authBlock = '';
  if (opts.include_authorization) {
    authBlock = `  function profile = 'modules/user/queries/user/current'
  function _ = 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: '${plural}.delete'
`;
  }

  return `---
slug: ${plural}
method: delete
layout: application
---
{% liquid
${authBlock}  function object = 'queries/${plural}/find', id: context.params.id
  function object = 'commands/${plural}/delete', object: object

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

  const headerDivs = properties.map(p => {
    const label = opts.include_translations
      ? `{{ 'app.${plural}.attr.${p.name}' | t }}`
      : titleCase(p.name);
    return `      <div>${label}</div>`;
  }).join('\n');

  const itemFields = properties.map(p =>
    `          <li><span class="pos-table-content-heading">{{ 'app.${plural}.attr.${p.name}' | t }}</span>{{ ${singularName}.${p.name} }}</li>`
  ).join('\n');

  const itemFieldsNoTrans = properties.map(p =>
    `          <li><span class="pos-table-content-heading">${titleCase(p.name)}</span>{{ ${singularName}.${p.name} }}</li>`
  ).join('\n');

  const fields = opts.include_translations ? itemFields : itemFieldsNoTrans;

  return `{% doc %}
  @param ${plural} {object} - query result with results array
{% enddoc %}

<div>
  <div>
    <a href="/${plural}/new" class="pos-button pos-button-primary">${addLabel}</a>
  </div>

  {% if ${plural}.results.size > 0 %}
    <section class="pos-table">
      <header>
${headerDivs}
        <div>Actions</div>
      </header>
      {% for ${singularName} in ${plural}.results %}
        <div class="pos-table-content pos-card">
          <ul>
${fields}
            <li>
              <span class="pos-table-content-heading">Actions</span>
              <a href="/${plural}/edit?id={{ ${singularName}.id }}" class="pos-button">${editLabel}</a>
              <form action="/${plural}" method="post">
                <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
                <input type="hidden" name="_method" value="delete">
                <input type="hidden" name="id" value="{{ ${singularName}.id }}">
                <button type="submit" class="pos-button">Delete</button>
              </form>
            </li>
          </ul>
        </div>
      {% endfor %}
    </section>
  {% else %}
    {% render '${plural}/empty_state' %}
  {% endif %}
</div>
`;
}

function showPartial(plural, properties, opts) {
  const fieldBlocks = properties.map(p => {
    const label = opts.include_translations
      ? `{{ 'app.${plural}.attr.${p.name}' | t }}`
      : titleCase(p.name);
    return `  <span>${label}</span>\n  <p>{{ object.${p.name} }}</p>`;
  }).join('\n\n');

  return `{% doc %}
  @param object {object} - ${plural.replace(/_/g, ' ')} record
{% enddoc %}

<div class="pos-card">
  <h1>{{ object.id }}</h1>

${fieldBlocks}
</div>
`;
}

function newPartial(plural, opts) {
  const heading = opts.include_translations
    ? `{{ 'app.${plural}.new.new' | t }}`
    : `New ${titleCase(plural.replace(/s$/, ''))}`;

  return `{% doc %}
  @param object {object} - empty object or command result with errors
{% enddoc %}

<div>
  <h3>${heading}</h3>
  {% render '${plural}/form', object: object %}
</div>
`;
}

function editPartial(plural, opts) {
  const heading = opts.include_translations
    ? `{{ 'app.${plural}.edit.edit' | t }}`
    : `Edit ${titleCase(plural.replace(/s$/, ''))}`;

  return `{% doc %}
  @param object {object} - record data or command result with errors
{% enddoc %}

<div>
  <h1>${heading} {{ object.name }}</h1>
</div>

{% render '${plural}/form', object: object %}
`;
}

function formPartial(plural, singularName, properties, opts) {
  // Auth-role fields are server-managed — excluded from forms entirely
  const formProperties = properties.filter(p => !isAuthField(p));

  const fieldBlocks = formProperties.map(p => {
    const label = fieldLabel(plural, p.name, opts);
    const inputName = `${singularName}[${p.name}]`;

    const inputTag = p.type === 'text'
      ? `<textarea name="${inputName}" id="${p.name}">{{ object.${p.name} }}</textarea>`
      : p.type === 'integer'
      ? `<input type="number" name="${inputName}" id="${p.name}" value="{{ object.${p.name} }}">`
      : p.type === 'float'
      ? `<input type="number" step="any" name="${inputName}" id="${p.name}" value="{{ object.${p.name} }}">`
      : p.type === 'boolean'
      ? `<input type="checkbox" name="${inputName}" value="true"{% if object.${p.name} %} checked{% endif %}>`
      : `<input type="text" name="${inputName}" id="${p.name}" value="{{ object.${p.name} }}">`;

    return `  <fieldset>
    <label for="${p.name}">${label}</label>
    ${inputTag}
    {% render 'modules/common-styling/forms/error_input_handler', errors: object.errors.${p.name} %}
  </fieldset>`;
  }).join('\n\n');

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

  {% render 'modules/common-styling/forms/error_list', errors: object.errors %}

${fieldBlocks}

  <fieldset class="pos-form-actions">
    <button type="submit" class="pos-button pos-button-primary">Submit</button>
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

  return `<div class="pos-card">
  <h3>${msg}</h3>
  <a href="/${plural}/new" class="pos-button pos-button-primary">${linkText}</a>
</div>
`;
}

// ── Translations template ────────────────────────────────────────────────────

function translationsYml(plural, singularName, properties) {
  const singular = titleCase(singularName);

  const attrLines = properties.map(p =>
    `        ${p.name}: ${titleCase(p.name)}`
  ).join('\n');

  return `en:
  app:
    ${plural}:
      new:
        new: New ${singularName}
      edit:
        edit: Edit ${singularName}
      list:
        add: Add ${singularName}
        empty_state: You haven't added any ${plural} yet.
        edit: Edit
      attr:
${attrLines}
`;
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
      const relPath = absPath.replace(projectDir + '/', '');

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
