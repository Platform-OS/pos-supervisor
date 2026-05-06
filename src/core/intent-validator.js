/**
 * intent-validator.js — pure validation logic for validate_intent tool.
 *
 * Two tracks:
 *   Track A: scaffold output → layers 3 + 4 only
 *   Track B: manual intent  → all 4 layers
 *
 * All exported functions are side-effect-free except validateIntent (async, calls getProjectMap).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { getProjectMap } from '../tools/project-map.js';
import { scanModule } from './module-scanner.js';
import { getTriggeredGotchas } from './knowledge-loader.js';
import { parseLiquidFile, extractAllFromAST } from './liquid-parser.js';
import { resolveRenderName } from './project-scanner.js';
import { isOrphanPartial } from './orphan-detector.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ROLES = new Set([
  'page', 'layout', 'partial', 'graphql', 'schema',
  'command', 'query', 'translation', 'lib', 'asset', 'config', 'migration',
  'module_override',
]);

const VALID_ACTIONS = new Set(['create', 'update', 'delete', 'move']);

/**
 * Role → required path regex.
 * Order matters for lib: must NOT match commands/ or queries/ subdirs.
 */
const ROLE_PATH_RULES = {
  page:        /^app\/views\/pages\/.+\.(liquid|html\.liquid)$/,
  layout:      /^app\/views\/layouts\/.+\.liquid$/,
  partial:     /^app\/views\/partials\/.+\.liquid$/,
  graphql:     /^app\/graphql\/.+\.graphql$/,
  schema:      /^app\/schema\/.+\.yml$/,
  command:     /^app\/lib\/commands\/.+\.liquid$/,
  query:       /^app\/lib\/queries\/.+\.liquid$/,
  translation: /^app\/translations\/.+\.yml$/,
  lib:             /^app\/lib\/(?!commands\/|queries\/).+/,
  asset:           /^app\/assets\/.+/,
  config:          /^app\/config\.yml$/,
  migration:       /^app\/migrations\/.+\.liquid$/,
  // Module override: project-owned files placed in app/modules/ to override installed module behaviour.
  // Different from bare modules/ paths (third-party read-only code — still write-protected).
  module_override: /^app\/modules\/[^/]+\/(public|private)\/.+/,
};

/**
 * Human-readable path pattern for error messages.
 */
const ROLE_PATH_EXAMPLES = {
  page:        'app/views/pages/<name>.html.liquid',
  layout:      'app/views/layouts/<name>.liquid',
  partial:     'app/views/partials/<name>.liquid',
  graphql:     'app/graphql/<name>.graphql',
  schema:      'app/schema/<name>.yml',
  command:     'app/lib/commands/<name>.liquid',
  query:       'app/lib/queries/<name>.liquid',
  translation: 'app/translations/<locale>.yml',
  lib:             'app/lib/<name>.liquid (not under commands/ or queries/)',
  asset:           'app/assets/<subdir>/<filename>',
  config:          'app/config.yml',
  migration:       'app/migrations/<timestamp>_<name>.liquid',
  module_override: 'app/modules/<module_name>/public/<path> or app/modules/<module_name>/private/<path>',
};

/** Scaffold domain → intent role mapping */
const DOMAIN_TO_ROLE = {
  config:       'config',
  layout:       'layout',
  schema:       'schema',
  graphql:      'graphql',
  queries:      'query',
  commands:     'command',
  partials:     'partial',
  pages:        'page',
  translations: 'translation',
};

/** Role → domain key for knowledge lookup */
const ROLE_TO_DOMAIN = {
  page: 'pages', layout: 'layouts', partial: 'partials', graphql: 'graphql',
  schema: 'schema', command: 'commands', query: 'queries', translation: 'translations',
};

/** Domain rules per role — concise, actionable */
const ROLE_RULES = {
  page: 'Controller-only — define slug/method in frontmatter, delegate rendering to partials via {% render %}. No HTML.',
  layout: 'Wraps pages. Use {{ content_for_layout }} for the page body. One per layout name.',
  partial: 'Scope-isolated UI fragments. Declare all params in {% doc %} block. Receive data via render args only.',
  graphql: 'GraphQL operations for database access. Define query/mutation with typed arguments.',
  schema: 'YAML table definitions. Properties define the record structure.',
  command: '3-file pattern: main (orchestration) + build (shape data) + check (validate). Commands mutate state.',
  query: 'Read-only data access. Wraps a GraphQL query with {% graphql %} tag. Returns results to caller.',
  translation: 'YAML key-value pairs per locale. Referenced via {{ key | t }} filter.',
};

/** Educational explanations for validation errors — explains WHY, not just what */
const ERROR_EXPLANATIONS = {
  invalid_path_for_role: 'platformOS uses a convention-over-configuration directory structure. Each file role has a specific directory — placing files in the wrong directory means the platform cannot find them at runtime.',
  missing_partial: 'When a file uses {% render "name" %}, the partial must exist at app/views/partials/name.liquid. Without it, the page will fail with a "partial not found" error at runtime.',
  missing_graphql: 'When a file uses {% graphql result = "name" %}, the operation must exist at app/graphql/name.graphql. Without it, the query will fail silently or error at runtime.',
  missing_schema: 'GraphQL record operations reference tables defined in app/schema/. Without the schema file, the table does not exist and all record operations will fail.',
  partial_invokes_graphql: 'Partials are UI components — they receive data through parameters, not by fetching it themselves. This separation ensures partials are reusable and testable. Move data fetching to pages or query wrappers.',
  partial_calls_command: 'Commands perform mutations. They should only be orchestrated from pages (which handle the HTTP request/response cycle). Partials are rendering components.',
  create_conflict: 'Creating a file that already exists would silently overwrite it. Use action "update" to explicitly modify an existing file.',
  module_write_protected: 'Module files under modules/ are third-party code installed via pos-cli. Modifying them would be overwritten on the next module update. Use app/modules/<name>/ for overrides instead.',
  shopify_terminology: 'platformOS is not Shopify. It has different data model (records, not products/collections), different objects (context.*, not shop/cart/customer), and different patterns.',
};

/** Known Shopify-specific terms that indicate platform confusion */
const SHOPIFY_TERMS = [
  /\bshop\./,
  /\bcart\./,
  /\bcheckout\./,
  /\|\s*money\b/,
  /\|\s*img_url\b/,
  /\{%-?\s*form\s/,
  /\{%-?\s*paginate\s/,
  /\{%-?\s*section\s/,
  /\bcustomer\./,
];

/** Error type → allowed_next_action code + guidance template */
const ERROR_TO_ACTION = {
  schema_error:           { action: 'fix_schema', guidance: 'Correct the intent object structure.' },
  invalid_role:           { action: 'change_file_role', guidance: 'Use a valid role: page, layout, partial, graphql, schema, command, query, translation, lib, asset, config, migration, module_override.' },
  invalid_action:         { action: 'change_action', guidance: 'Use a valid action: create, update, delete, move.' },
  missing_move_to:        { action: 'add_move_to', guidance: 'Provide move_to (destination path) when action is "move".' },
  invalid_references:     { action: 'fix_references', guidance: 'references fields must be arrays of strings.' },
  unknown_top_level_key:  { action: 'fix_schema', guidance: 'Remove unrecognised top-level key. Allowed: goal, changes.' },
  invalid_path_for_role:  { action: 'revise_plan', guidance: (e) => `Move ${e.role} file to ${e.expected_pattern}` },
  module_write_protected: { action: 'revise_plan', guidance: 'Module files are read-only. Only delete or move actions are allowed on module paths.' },
  move_to_pattern_mismatch: { action: 'revise_plan', guidance: (e) => `move_to must also match ${e.expected_pattern}` },
  missing_partial:        { action: 'add_create_action', guidance: (e) => `Add { path: 'app/views/partials/${e.ref}.liquid', role: 'partial', action: 'create' } to changes` },
  missing_graphql:        { action: 'add_create_action', guidance: (e) => `Add { path: 'app/graphql/${e.ref}.graphql', role: 'graphql', action: 'create' } to changes` },
  missing_schema:         { action: 'add_create_action', guidance: (e) => `Add { path: 'app/schema/${e.ref}.yml', role: 'schema', action: 'create' } to changes` },
  missing_command:        { action: 'add_create_action', guidance: (e) => `Add ${e.ref} to changes with role 'command' and action 'create'` },
  missing_query:          { action: 'add_create_action', guidance: (e) => `Add ${e.ref} to changes with role 'query' and action 'create'` },
  missing_translation:    { action: 'add_translation_file', guidance: 'Add a translation file (role: translation, action: create) to the plan, or verify the key exists in the project.' },
  update_target_missing:  { action: 'verify_path', guidance: (e) => `Verify '${e.path}' exists in the project before updating it.` },
  delete_target_missing:  { action: 'verify_path', guidance: (e) => `Verify '${e.path}' exists in the project before deleting it.` },
  create_conflict:        { action: 'change_action', guidance: (e) => `'${e.path}' already exists. Use action 'update' if you intend to modify it.` },
  duplicate_create:       { action: 'revise_plan', guidance: (e) => `Remove duplicate create entry for '${e.path}'.` },
  scaffold_conflict:      { action: 'resolve_conflict', guidance: (e) => `Scaffold conflict: ${e.reason}. Remove or rename the existing file first, or use update.` },
  module_partial_missing: { action: 'install_module', guidance: (e) => `Module partial '${e.ref}' references a module that may not be installed. Check project_map for installed modules.` },
  partial_invokes_graphql:   { action: 'extract_to_query', guidance: 'Move the GraphQL call to app/lib/queries/ and pass results as a @param from the page.' },
  partial_calls_command:     { action: 'move_to_page', guidance: 'Commands are orchestrated from pages only. Move command invocation to the page.' },
  cross_change_role_conflict: { action: 'fix_role', guidance: (e) => `'${e.ref}' is used as a partial but declared as '${e.declared_role}'. Fix the role to 'partial' or correct the reference.` },
};

// ---------------------------------------------------------------------------
// Path normalisation — must match project-scanner.js exactly
// ---------------------------------------------------------------------------

export function partialPathToName(path) {
  return path
    .replace(/^app\/views\/partials\//, '')
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');
}

export function graphqlPathToName(path) {
  return path
    .replace(/^app\/graphql\//, '')
    .replace(/\.graphql$/, '');
}

export function schemaPathToName(path) {
  return path
    .replace(/^app\/schema\//, '')
    .replace(/\.yml$/, '');
}

// ---------------------------------------------------------------------------
// plan_id — deterministic djb2 hash
// ---------------------------------------------------------------------------

export function buildPlanId(changes) {
  const sorted = changes.map(c => `${c.action}:${c.path}`).sort().join('|');
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) + hash) ^ sorted.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Pending resolution — files being created in this plan are valid references
// ---------------------------------------------------------------------------

export function buildPendingResolution(changes) {
  const pending = {
    partials:             new Set(),
    graphql:              new Set(),
    schemas:              new Set(),
    commands:             new Set(),
    queries:              new Set(),
    files:                new Set(),
    hasTranslationCreate: false,
  };

  for (const change of changes) {
    if (change.action !== 'create' && change.action !== 'move') continue;
    const path = change.action === 'move' ? change.move_to : change.path;

    pending.files.add(path);
    switch (change.role) {
      case 'partial':     pending.partials.add(partialPathToName(path));  break;
      case 'graphql':     pending.graphql.add(graphqlPathToName(path));   break;
      case 'schema':      pending.schemas.add(schemaPathToName(path));    break;
      case 'command':     pending.commands.add(path);                     break;
      case 'query':       pending.queries.add(path);                      break;
      case 'translation': pending.hasTranslationCreate = true;            break;
    }
  }

  return pending;
}

// ---------------------------------------------------------------------------
// Layer 1 — Schema check (Track B only)
// ---------------------------------------------------------------------------

/**
 * Coerce an intent object before validation: if `changes` is a JSON string
 * (common LLM serialisation error), parse it into an array. Returns a new
 * object so the original is not mutated.
 */
export function coerceIntent(intent) {
  if (!intent || typeof intent !== 'object') return intent;
  if (typeof intent.changes !== 'string') return intent;
  try {
    const parsed = JSON.parse(intent.changes);
    if (Array.isArray(parsed)) {
      return { ...intent, changes: parsed };
    }
  } catch { /* fall through — schema layer will report the error */ }
  return intent;
}

export function validateSchema(intent) {
  // Apply string→array coercion before validation so downstream layers
  // receive a proper object even if the model serialised changes as JSON.
  // eslint-disable-next-line no-param-reassign
  intent = coerceIntent(intent);

  const errors = [];

  // Top-level key guard
  const ALLOWED_KEYS = new Set(['goal', 'changes']);
  for (const key of Object.keys(intent)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors.push({
        layer: 'schema',
        type: 'unknown_top_level_key',
        key,
        message: `Unknown top-level key '${key}'. Allowed: goal, changes. Did you mean 'changes' instead of '${key}'?`,
      });
    }
  }

  if (!('goal' in intent) || intent.goal === undefined) {
    errors.push({ layer: 'schema', type: 'schema_error', field: 'goal', message: 'Missing required field: goal' });
  } else if (typeof intent.goal !== 'string' || intent.goal.trim() === '') {
    errors.push({ layer: 'schema', type: 'schema_error', field: 'goal', message: 'goal must be a non-empty string' });
  }

  if (!('changes' in intent) || intent.changes === undefined) {
    errors.push({ layer: 'schema', type: 'schema_error', field: 'changes', message: 'Missing required field: changes' });
  } else if (!Array.isArray(intent.changes)) {
    errors.push({ layer: 'schema', type: 'schema_error', field: 'changes', message: 'changes must be an array — pass an array of objects, not a JSON string' });
  } else if (intent.changes.length === 0) {
    errors.push({ layer: 'schema', type: 'schema_error', field: 'changes', message: 'changes must not be empty' });
  } else {
    for (let i = 0; i < intent.changes.length; i++) {
      const c = intent.changes[i];
      const prefix = `changes[${i}]`;

      if (!c || typeof c !== 'object') {
        errors.push({ layer: 'schema', type: 'schema_error', field: prefix, message: `${prefix} must be an object` });
        continue;
      }

      if (typeof c.path !== 'string' || c.path.trim() === '') {
        errors.push({ layer: 'schema', type: 'schema_error', field: `${prefix}.path`, message: `${prefix}.path must be a non-empty string` });
      }

      if (!VALID_ROLES.has(c.role)) {
        errors.push({
          layer: 'schema',
          type: 'invalid_role',
          field: `${prefix}.role`,
          value: c.role,
          message: `${prefix}.role '${c.role}' is not valid. Allowed: ${[...VALID_ROLES].join(', ')}`,
        });
      }

      if (!VALID_ACTIONS.has(c.action)) {
        errors.push({
          layer: 'schema',
          type: 'invalid_action',
          field: `${prefix}.action`,
          value: c.action,
          message: `${prefix}.action '${c.action}' is not valid. Allowed: create, update, delete, move`,
        });
      }

      if (c.action === 'move') {
        if (typeof c.move_to !== 'string' || c.move_to.trim() === '') {
          errors.push({
            layer: 'schema',
            type: 'missing_move_to',
            field: `${prefix}.move_to`,
            message: `${prefix}.action is 'move' but move_to is missing or empty`,
          });
        }
      }

      // references fields must be arrays of strings
      if (c.references !== undefined) {
        if (typeof c.references !== 'object' || Array.isArray(c.references) || c.references === null) {
          errors.push({ layer: 'schema', type: 'invalid_references', field: `${prefix}.references`, message: `${prefix}.references must be an object` });
        } else {
          const REF_FIELDS = ['partials', 'graphql', 'schemas', 'translations', 'commands', 'queries'];
          for (const field of REF_FIELDS) {
            if (field in c.references) {
              const val = c.references[field];
              if (!Array.isArray(val) || val.some(v => typeof v !== 'string')) {
                errors.push({
                  layer: 'schema',
                  type: 'invalid_references',
                  field: `${prefix}.references.${field}`,
                  message: `${prefix}.references.${field} must be an array of strings`,
                });
              }
            }
          }
        }
      }
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true };
}

// ---------------------------------------------------------------------------
// Layer 2 — Domain check (Track B only)
// ---------------------------------------------------------------------------

export function validateDomain(changes) {
  const errors = [];

  for (const change of changes) {
    const rule = ROLE_PATH_RULES[change.role];
    if (!rule) continue; // invalid role already caught in layer 1

    const path = change.path;

    if (!rule.test(path)) {
      errors.push({
        layer: 'domain',
        type: 'invalid_path_for_role',
        path,
        role: change.role,
        message: `Role '${change.role}' requires path matching ${ROLE_PATH_EXAMPLES[change.role]}`,
        expected_pattern: ROLE_PATH_EXAMPLES[change.role],
        suggestion: `Rename to ${ROLE_PATH_EXAMPLES[change.role].replace('<name>', basename(path).replace(/\.\w+$/, '').replace(/\.html$/, ''))}`
      });
    }

    // Module write protection
    if (path.startsWith('modules/') && (change.action === 'create' || change.action === 'update')) {
      errors.push({
        layer: 'domain',
        type: 'module_write_protected',
        path,
        action: change.action,
        message: `Module files are read-only. Cannot ${change.action} '${path}'. Only delete and move are allowed on module paths.`,
      });
    }

    // Move destination must satisfy same role pattern
    if (change.action === 'move' && change.move_to) {
      if (!rule.test(change.move_to)) {
        errors.push({
          layer: 'domain',
          type: 'move_to_pattern_mismatch',
          path,
          move_to: change.move_to,
          role: change.role,
          message: `move_to '${change.move_to}' does not match the pattern for role '${change.role}': ${ROLE_PATH_EXAMPLES[change.role]}`,
          expected_pattern: ROLE_PATH_EXAMPLES[change.role],
        });
      }
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true };
}

/**
 * Extract basename from a path (used for suggestion text in domain errors).
 */
function basename(path) {
  return path.split('/').pop() ?? path;
}

// ---------------------------------------------------------------------------
// Layer 3 — Project-state check (both tracks)
// ---------------------------------------------------------------------------

/**
 * Collect all paths that exist in projectMap for existence checks
 * on update/delete actions.
 */
function buildProjectPathSet(projectMap) {
  const paths = new Set();

  // partials: stored as name → { path }
  for (const entry of Object.values(projectMap.partials ?? {})) {
    if (entry.path) paths.add(entry.path);
  }
  // pages: stored as slug → { path }
  for (const entry of Object.values(projectMap.pages ?? {})) {
    if (entry.path) paths.add(entry.path);
  }
  // commands, queries: key IS the path
  for (const p of Object.keys(projectMap.commands ?? {})) paths.add(p);
  for (const p of Object.keys(projectMap.queries ?? {})) paths.add(p);
  // graphql: key is 'blog_posts/search' → reconstruct path
  for (const k of Object.keys(projectMap.graphql ?? {})) {
    paths.add(`app/graphql/${k}.graphql`);
  }
  // schema: key is table name → reconstruct path
  for (const k of Object.keys(projectMap.schema ?? {})) {
    paths.add(`app/schema/${k}.yml`);
  }
  // translations: key is locale → reconstruct path (approximate)
  for (const locale of Object.keys(projectMap.translations ?? {})) {
    paths.add(`app/translations/${locale}.yml`);
  }

  return paths;
}

export function validateProjectState(changes, projectMap, options = {}) {
  // projectDir enables filesystem fallback for stale-index cases (files written in a previous
  // session that the cached project_map hasn't indexed yet). When null (unit test mode),
  // all checks rely solely on projectMap — consistent with the original pure-function contract.
  const { scaffoldConflicts = [], projectDir = null } = options;

  /** Check whether a relative path exists on disk. Only called when not in projectMap. */
  const existsOnDisk = projectDir
    ? (relPath) => existsSync(join(projectDir, relPath))
    : () => false;
  const errors = [];
  const warnings = [];

  const pending = buildPendingResolution(changes);
  const projectPaths = buildProjectPathSet(projectMap);

  // Scaffold conflict errors (Track A)
  for (const conflict of scaffoldConflicts) {
    errors.push({
      layer: 'project_state',
      type: 'scaffold_conflict',
      path: conflict.path,
      reason: conflict.reason,
      message: `Scaffold conflict at '${conflict.path}': ${conflict.reason}`,
      suggestion: `Remove or rename the existing file first, or change its action to 'update'.`,
    });
  }

  // Track seen create paths for duplicate detection
  const seenCreates = new Set();

  for (const change of changes) {
    const { path, role, action, references = {} } = change;

    // Duplicate create check
    if (action === 'create') {
      if (seenCreates.has(path)) {
        errors.push({
          layer: 'project_state',
          type: 'duplicate_create',
          path,
          message: `Duplicate create action for '${path}' in the same plan.`,
          suggestion: `Remove the duplicate entry for '${path}'.`,
        });
      }
      seenCreates.add(path);
    }

    // Create conflict: file already exists in project.
    // Fallback to existsSync when not in projectMap — catches files written in a previous
    // session that a stale cache hasn't indexed yet.
    if (action === 'create' && !pending.files.has(path)) {
      if (projectPaths.has(path) || existsOnDisk(path)) {
        errors.push({
          layer: 'project_state',
          type: 'create_conflict',
          path,
          message: `'${path}' already exists in the project.`,
          suggestion: `Use action 'update' if you intend to modify the existing file.`,
        });
      }
    }

    // Update/delete target must exist.
    // module_override paths are exempt: the project scanner does not index app/modules/ files,
    // so existence cannot be verified programmatically. The agent is responsible for confirming
    // the override target exists in the installed module before declaring update/delete.
    //
    // For all other roles: check projectMap first, then fall back to existsSync.
    // A stale cache (files written in a previous session) must not produce false positives.
    if (role !== 'module_override') {
      if (action === 'update' && !projectPaths.has(path)) {
        if (!existsOnDisk(path)) {
          errors.push({
            layer: 'project_state',
            type: 'update_target_missing',
            path,
            message: `Cannot update '${path}': file does not exist in the project.`,
            suggestion: `Use action 'create' if this is a new file, or verify the path is correct.`,
          });
        } else {
          // Exists on disk but not indexed — stale cache, non-blocking advisory
          warnings.push({
            layer: 'project_state',
            type: 'stale_index',
            path,
            message: `'${path}' exists on disk but is not in the project index (cache may be stale). Call project_map with force_refresh:true to update.`,
          });
        }
      }

      if (action === 'delete' && !projectPaths.has(path)) {
        if (!existsOnDisk(path)) {
          errors.push({
            layer: 'project_state',
            type: 'delete_target_missing',
            path,
            message: `Cannot delete '${path}': file does not exist in the project.`,
            suggestion: `Verify the path is correct. Remove this change if the file does not exist.`,
          });
        } else {
          warnings.push({
            layer: 'project_state',
            type: 'stale_index',
            path,
            message: `'${path}' exists on disk but is not in the project index (cache may be stale). Call project_map with force_refresh:true to update.`,
          });
        }
      }
    }

    // ---------------------------------------------------------------------------
    // Reference checks
    //
    // Module refs (starting with 'modules/') are handled separately from app refs:
    //   - Module file contents are NOT indexed by the project scanner
    //   - The only verifiable fact is whether the module is installed
    //   - If the module is installed: accept (trust installed module contents)
    //   - If the module is NOT installed: warn (not a hard error — module may be added later)
    //
    // This applies to all reference types: partials, graphql, commands, queries, schemas.
    // ---------------------------------------------------------------------------

    const installedModules = projectMap.project?.modules ?? [];

    /**
     * Emit a warning when a module ref points to a module that is not installed.
     * Returns true if the ref was a module ref (caller should skip the app-level check).
     */
    const checkModuleRef = (ref, refType) => {
      if (!ref.startsWith('modules/')) return false;
      const moduleName = ref.split('/')[1];
      if (!installedModules.includes(moduleName)) {
        warnings.push({
          layer: 'project_state',
          type: 'module_ref_not_installed',
          path,
          ref,
          module: moduleName,
          ref_type: refType,
          message: `${refType} '${ref}' references module '${moduleName}' which does not appear to be installed.`,
          suggestion: `Install the '${moduleName}' module, or remove this reference.`,
        });
      } else if (projectDir) {
        // Module is installed — verify the referenced path actually exists on disk
        const refPath = ref.replace(/^modules\/[^/]+\//, '');
        const candidates = [
          join(projectDir, 'modules', moduleName, 'public', 'views', 'partials', 'lib', `${refPath}.liquid`),
          join(projectDir, 'modules', moduleName, 'public', 'views', 'partials', `${refPath}.liquid`),
          join(projectDir, 'modules', moduleName, 'public', `${refPath}.liquid`),
          join(projectDir, 'modules', moduleName, 'public', 'graphql', `${refPath}.graphql`),
        ];
        const found = candidates.some(c => existsSync(c));
        if (!found) {
          warnings.push({
            layer: 'project_state',
            type: 'module_ref_path_not_found',
            path,
            ref,
            module: moduleName,
            ref_type: refType,
            message: `${refType} '${ref}' references module '${moduleName}' (installed) but the path was not found. Verify the exact call path with module_info.`,
            suggestion: `Call module_info({ name: '${moduleName}', section: 'api' }) to see available ${refType.toLowerCase()} paths.`,
          });
        }
      }
      return true;
    };

    for (const ref of references.partials ?? []) {
      if (checkModuleRef(ref, 'Partial')) continue;
      if (!pending.partials.has(ref) && !Object.hasOwn(projectMap.partials ?? {}, ref)) {
        errors.push({
          layer: 'project_state',
          type: 'missing_partial',
          path,
          ref,
          message: `Partial '${ref}' does not exist in the project and is not being created in this plan.`,
          suggestion: `Either add { path: 'app/views/partials/${ref}.liquid', role: 'partial', action: 'create' } to changes, or remove the reference.`,
        });
      }
    }

    for (const ref of references.graphql ?? []) {
      if (checkModuleRef(ref, 'GraphQL operation')) continue;
      if (!pending.graphql.has(ref) && !Object.hasOwn(projectMap.graphql ?? {}, ref)) {
        errors.push({
          layer: 'project_state',
          type: 'missing_graphql',
          path,
          ref,
          message: `GraphQL operation '${ref}' does not exist in the project and is not being created in this plan.`,
          suggestion: `Either add { path: 'app/graphql/${ref}.graphql', role: 'graphql', action: 'create' } to changes, or remove the reference.`,
        });
      }
    }

    for (const ref of references.schemas ?? []) {
      if (checkModuleRef(ref, 'Schema')) continue;
      if (!pending.schemas.has(ref) && !Object.hasOwn(projectMap.schema ?? {}, ref)) {
        errors.push({
          layer: 'project_state',
          type: 'missing_schema',
          path,
          ref,
          message: `Schema '${ref}' does not exist in the project and is not being created in this plan.`,
          suggestion: `Either add { path: 'app/schema/${ref}.yml', role: 'schema', action: 'create' } to changes, or remove the reference.`,
        });
      }
    }

    for (const ref of references.commands ?? []) {
      if (checkModuleRef(ref, 'Command')) continue;
      if (!pending.commands.has(ref) && !Object.hasOwn(projectMap.commands ?? {}, ref)) {
        errors.push({
          layer: 'project_state',
          type: 'missing_command',
          path,
          ref,
          message: `Command '${ref}' does not exist in the project and is not being created in this plan.`,
          suggestion: `Either add the command to changes, or remove the reference.`,
        });
      }
    }

    for (const ref of references.queries ?? []) {
      if (checkModuleRef(ref, 'Query')) continue;
      if (!pending.queries.has(ref) && !Object.hasOwn(projectMap.queries ?? {}, ref)) {
        errors.push({
          layer: 'project_state',
          type: 'missing_query',
          path,
          ref,
          message: `Query '${ref}' does not exist in the project and is not being created in this plan.`,
          suggestion: `Either add the query to changes, or remove the reference.`,
        });
      }
    }

    for (const key of references.translations ?? []) {
      if (pending.hasTranslationCreate) {
        // Translation file is being created — warn but don't block
        warnings.push({
          layer: 'project_state',
          type: 'unverified_translation',
          path,
          ref: key,
          message: `Translation key '${key}' cannot be verified: a translation file is being created in this plan. Ensure the translation file covers this key.`,
        });
      } else {
        // No translation file in plan — check if key exists in any locale
        const allLocales = Object.values(projectMap.translations ?? {});
        const keyExists = allLocales.some(locale => Object.hasOwn(locale, key));
        if (!keyExists) {
          errors.push({
            layer: 'project_state',
            type: 'missing_translation',
            path,
            ref: key,
            message: `Translation key '${key}' does not exist in any locale and no translation file is being created in this plan.`,
            suggestion: `Add a translation file to the plan (role: 'translation', action: 'create'), or remove the translation reference.`,
          });
        }
      }
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Layer 4 — Policy check (both tracks)
// ---------------------------------------------------------------------------

export function validatePolicy(changes, projectMap) {
  const errors = [];
  const warnings = [];

  // Build a lookup: partial name → declared role in this plan (for cross-change conflict check)
  const planRoleByPartialName = new Map();
  for (const change of changes) {
    if (change.role === 'partial') {
      planRoleByPartialName.set(partialPathToName(change.path), 'partial');
    }
  }

  // Build set of partial names referenced by any change in this plan
  const referencedPartials = new Set();
  for (const change of changes) {
    for (const ref of change.references?.partials ?? []) {
      referencedPartials.add(ref);
    }
  }

  const hasMigrationInPlan = changes.some(c => c.role === 'migration');

  for (const change of changes) {
    const { path, role, action, references = {} } = change;

    // P1: Partial invokes GraphQL directly
    if (role === 'partial' && (references.graphql?.length ?? 0) > 0) {
      errors.push({
        layer: 'policy',
        type: 'partial_invokes_graphql',
        path,
        message: `Partial '${path}' references GraphQL operations directly. Partials cannot invoke GraphQL.`,
        suggestion: `Move the query to app/lib/queries/ and pass results as a @param from the page.`,
      });
    }

    // P2: Partial calls command
    if (role === 'partial' && (references.commands?.length ?? 0) > 0) {
      errors.push({
        layer: 'policy',
        type: 'partial_calls_command',
        path,
        message: `Partial '${path}' references commands. Commands are orchestrated from pages only.`,
        suggestion: `Move command invocation to the page that renders this partial.`,
      });
    }

    // P3: Cross-change role conflict
    // A ref in references.partials points to a name, but another change in this plan
    // creates that name with a non-partial role.
    for (const ref of references.partials ?? []) {
      const planChange = changes.find(c =>
        c.action === 'create' && partialPathToName(c.path) === ref && c.role !== 'partial'
      );
      if (planChange) {
        errors.push({
          layer: 'policy',
          type: 'cross_change_role_conflict',
          path,
          ref,
          declared_role: planChange.role,
          message: `'${ref}' is referenced as a partial by '${path}', but is declared with role '${planChange.role}' in this plan. A partial name maps to app/views/partials/.`,
          suggestion: `Fix the role to 'partial' for '${planChange.path}', or correct the reference.`,
        });
      }
    }

    // P4: Schema deletion without migration
    if (role === 'schema' && action === 'delete' && !hasMigrationInPlan) {
      warnings.push({
        layer: 'policy',
        type: 'schema_deletion',
        path,
        message: `Deleting schema '${path}' will permanently drop all stored data for that table.`,
        suggestion: `Add a migration action to this plan for data cleanup before deletion.`,
      });
    }

    // P5: Orphan partial — created but not referenced in plan or project.
    //     Uses the shared predicate so we agree with analyze_project and the
    //     dep-graph orphaned-file detector.
    if (role === 'partial' && action === 'create') {
      const name = partialPathToName(path);
      if (isOrphanPartial(name, projectMap, { planReferencedPartials: referencedPartials })) {
        warnings.push({
          layer: 'policy',
          type: 'orphan_partial',
          path,
          message: `Partial '${path}' is not rendered by anything in this plan or the existing project.`,
          suggestion: `Verify this partial is needed. If it is, add a render reference from the page or parent partial.`,
        });
      }
    }

    // P6: Partial orchestrating data (both commands and queries)
    if (role === 'partial' &&
        (references.commands?.length ?? 0) > 0 &&
        (references.queries?.length ?? 0) > 0) {
      // Already caught by P2, but this is a distinct higher-level warning
      // P2 blocks on commands alone; P6 is about the combination → only warn if P2 didn't already fire
      if ((references.commands?.length ?? 0) === 0) {
        warnings.push({
          layer: 'policy',
          type: 'partial_orchestrating_data',
          path,
          message: `Partial '${path}' references both commands and queries — page-level orchestration in a partial.`,
          suggestion: `Consider promoting this to a page.`,
        });
      }
    }
  }

  // P7: Shopify terminology in goal (checked once on the plan, not per-change)
  // We get the goal from the outer caller; it's not accessible per-change.
  // The caller passes the goal separately — handled in validateIntent.

  return { errors, warnings };
}

/**
 * Check goal string for Shopify terminology (P7). Separate from validatePolicy
 * so it can receive the goal string directly.
 */
export function checkGoalForShopify(goal) {
  const warnings = [];
  if (typeof goal !== 'string') return warnings;

  for (const term of SHOPIFY_TERMS) {
    if (term.test(goal)) {
      warnings.push({
        layer: 'policy',
        type: 'shopify_terminology',
        message: `Goal mentions Shopify-specific terms ('${term.source}'). Ensure you are using platformOS equivalents.`,
        suggestion: `Call domain_guide for migration guidance from Shopify to platformOS.`,
      });
      break; // one warning per plan is enough
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Scaffold translation key extraction (Track A)
// ---------------------------------------------------------------------------

/**
 * Flatten nested YAML object to dot-notation leaf keys.
 * @param {object} obj
 * @param {string} prefix
 * @param {string[]} result
 */
function flattenYamlKeys(obj, prefix, result) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      flattenYamlKeys(v, key, result);
    } else {
      result.push(key);
    }
  }
}

/**
 * Extract all translation keys from scaffold translation YML files.
 *
 * Translation keys in Liquid use dot-notation WITHOUT the locale prefix:
 *   en.app.product_items.list.add  →  'app.product_items.list.add'
 *
 * These keys are returned as pending_translations so validate_code can
 * suppress TranslationKeyExists false-positives during scaffold validation
 * (the YML file hasn't been written to disk yet, but will be).
 *
 * @param {Array<{domain: string, content: string}>} scaffoldFiles
 * @returns {string[]}
 */
export function extractScaffoldTranslationKeys(scaffoldFiles) {
  const keys = [];
  for (const file of scaffoldFiles) {
    if (file.domain !== 'translations' || !file.content) continue;
    try {
      const parsed = yamlLoad(file.content);
      if (typeof parsed !== 'object' || parsed === null) continue;
      // Top-level keys are locale codes (e.g. 'en') — strip them
      for (const localeObj of Object.values(parsed)) {
        if (typeof localeObj === 'object' && localeObj !== null) {
          flattenYamlKeys(localeObj, '', keys);
        }
      }
    } catch { /* invalid YAML — skip silently */ }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Scaffold normalisation (Track A)
// ---------------------------------------------------------------------------

/**
 * Normalise a scaffold result into a Track-A validation input.
 *
 * Before Phase 2.4 this function produced changes with empty references{},
 * so the orphan_partial check (P5) fired on every scaffold-created partial —
 * intra-plan renders were invisible. Fix: parse every liquid file's content
 * (scaffold includes it verbatim) and populate references.partials with the
 * resolved render targets. Sibling renders like {% render 'form' %} inside
 * blog_posts/new.liquid are resolved to 'blog_posts/form' via the same
 * resolveRenderName helper the scanner uses, so P5 can cross-reference them.
 *
 * GraphQL references are populated on every role, not skipped for partials —
 * if scaffold ever regresses and emits a {% graphql %} inside a partial, we
 * WANT P1 (partial_invokes_graphql) to fire. Hiding it here would hide a bug.
 */
export function normalizeScaffoldInput(scaffoldOutput) {
  const files = scaffoldOutput.files ?? [];
  const summary = scaffoldOutput.summary ?? 'Scaffold output';

  const changes = files.map(file => {
    const role = DOMAIN_TO_ROLE[file.domain] ?? 'lib';
    const references = {};

    if (file.content && file.path.endsWith('.liquid')) {
      const ast = parseLiquidFile(file.content);
      if (ast) {
        const extracted = extractAllFromAST(ast);

        // Resolve relative render names against the caller's partial directory
        // so P5's referencedPartials set uses the same keys as the partial map.
        // Modules refs are dropped — P3 cross-change checks only cover app-local
        // partials, and module refs trigger their own module_ref_not_installed
        // path in validateProjectState via a different branch.
        const partialRefs = [];
        for (const renderName of extracted.renders) {
          if (renderName.startsWith('modules/')) continue;
          partialRefs.push(resolveRenderName(file.path, renderName));
        }
        if (partialRefs.length > 0) references.partials = [...new Set(partialRefs)];

        // GraphQL refs — populate on every role including partials. A partial
        // with a GraphQL ref is a scaffold regression; P1 (partial_invokes_graphql)
        // catches it explicitly with an educational error.
        const gqlRefs = extracted.graphql
          .map(g => (typeof g === 'string' ? g : g.queryName))
          .filter(name => typeof name === 'string' && !name.startsWith('modules/'));
        if (gqlRefs.length > 0) references.graphql = [...new Set(gqlRefs)];
      }
    }

    // Scaffold marks files it deep-merges into an existing artifact with
    // `existed: true` (today: the single `app/translations/<locale>.yml`).
    // Those are conceptually updates, not creates — we surface that so
    // validateProjectState can treat them like any other in-place edit.
    const action = file.existed ? 'update' : 'create';

    return {
      path: file.path,
      role,
      action,
      references,
    };
  });

  // Use summary as goal proxy
  const goal = summary;

  return { changes, goal };
}

// ---------------------------------------------------------------------------
// Output builders
// ---------------------------------------------------------------------------

function buildAllowedNextActions(errors) {
  // One entry per distinct error type, computed from actual errors
  const seen = new Set();
  const actions = [];

  for (const err of errors) {
    const key = err.type;
    if (seen.has(key)) continue;
    seen.add(key);

    const template = ERROR_TO_ACTION[err.type];
    if (!template) continue;

    const guidance = typeof template.guidance === 'function'
      ? template.guidance(err)
      : template.guidance;

    const entry = {
      action: template.action,
      for_error: err.type,
      guidance,
    };

    // Attach ref for missing-reference types so the model can act directly
    if (err.ref !== undefined) entry.ref = err.ref;
    if (err.path !== undefined) entry.path = err.path;

    actions.push(entry);
  }

  return actions;
}

function buildSummary(changes, warnings) {
  const counts = { create: 0, update: 0, delete: 0, move: 0 };
  const roles = {};

  for (const c of changes) {
    counts[c.action] = (counts[c.action] ?? 0) + 1;
    roles[c.role] = (roles[c.role] ?? 0) + 1;
  }

  const actionParts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([a, n]) => `${n} ${a}`)
    .join(', ');

  const roleParts = Object.entries(roles)
    .map(([r, n]) => `${n} ${r}${n > 1 ? 's' : ''}`)
    .join(', ');

  const warnSuffix = warnings.length > 0 ? ` ${warnings.length} warning${warnings.length > 1 ? 's' : ''}.` : '';

  return `Plan validated: ${actionParts}. Roles: ${roleParts}.${warnSuffix}`;
}

function collectPendingFiles(changes) {
  const files = [];
  for (const c of changes) {
    if (c.action === 'create') files.push(c.path);
    if (c.action === 'move' && c.move_to) files.push(c.move_to);
  }
  return files;
}

const VALIDATION_ORDER = [
  /^app\/schema\//,
  /^app\/graphql\//,
  /^app\/lib\/commands\//,
  /^app\/lib\/queries\//,
  /^app\/translations\//,
  /^app\/views\/layouts\//,
  /^app\/views\/pages\//,
  /^app\/views\/partials\//,
];

export function suggestValidationOrder(pendingFiles) {
  if (!pendingFiles || pendingFiles.length === 0) return [];
  function priority(path) {
    for (let i = 0; i < VALIDATION_ORDER.length; i++) {
      if (VALIDATION_ORDER[i].test(path)) return i;
    }
    return VALIDATION_ORDER.length;
  }
  return [...pendingFiles].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
}

function collectPendingTranslations(changes, extraKeys = []) {
  const keys = new Set(extraKeys);
  for (const c of changes) {
    for (const key of c.references?.translations ?? []) {
      keys.add(key);
    }
  }
  return [...keys];
}

function makeSuccess(changes, warnings, goal, projectMap, extraTranslationKeys = [], opts = {}) {
  const { trustedScaffold = false } = opts;
  const pendingFiles = collectPendingFiles(changes);

  // Build per-file generation context for create actions
  const generation_context = {};
  for (const change of changes) {
    if (change.action !== 'create') continue;
    const role = change.role;
    const domain = ROLE_TO_DOMAIN[role];
    const ctx = { role };

    // Domain rule for this role
    if (ROLE_RULES[role]) ctx.rules = [ROLE_RULES[role]];

    // Available resources the file might reference
    if (projectMap) {
      if (role === 'page' || role === 'partial') {
        const partials = Object.keys(projectMap.partials ?? {}).slice(0, 20);
        if (partials.length > 0) ctx.available_partials = partials;
      }
      if (role === 'page' || role === 'command') {
        const queries = Object.keys(projectMap.queries ?? {}).slice(0, 20);
        if (queries.length > 0) ctx.available_queries = queries;
      }
      if (role === 'command' || role === 'query') {
        const graphql = Object.keys(projectMap.graphql ?? {}).slice(0, 20);
        if (graphql.length > 0) ctx.available_graphql = graphql;
      }
    }

    // Gotchas to avoid for this domain
    if (domain) {
      try {
        const triggered = getTriggeredGotchas(domain, {
          checks: new Set(), tags: new Set(), filters: new Set(),
        });
        if (triggered?.gotchas?.length > 0) {
          ctx.avoid = triggered.gotchas.map(g => g.message);
        }
      } catch { /* best-effort */ }
    }

    generation_context[change.path] = ctx;
  }

  const pendingTranslations = collectPendingTranslations(changes, extraTranslationKeys);

  // Trust boundary: scaffold output is verified here (schema, paths, project state,
  // policy, cross-refs, parsed render graph). Once it passes Track A, agents MUST
  // write files verbatim — no per-file validate_code. That's the whole point of a
  // deterministic generator: calling validate_code on its output re-lints content
  // the generator already guarantees, producing false-positive loops.
  //
  // Manual plans (Track B) get the opposite contract: they declare intent but haven't
  // produced content yet, so each file MUST pass validate_code before write.
  const nextStep = trustedScaffold
    ? `Plan validated (trusted scaffold). Write every file in scaffold output EXACTLY as generated — do NOT call validate_code on scaffold-produced files. ` +
      `pending_files and pending_translations have been recorded in session; any manual edit you make after writing must pass validate_code with session pending merged.`
    : (pendingFiles.length > 0
        ? `Plan validated. Draft each file, then call validate_code on the full content before writing. session.pending (pending_files + pending_translations) is set — validate_code merges it automatically, you do not need to re-pass it.`
        : 'Plan validated. Proceed with the plan.');

  return {
    ok: true,
    plan_id: buildPlanId(changes),
    summary: buildSummary(changes, warnings),
    pending_files: pendingFiles,
    suggested_validation_order: suggestValidationOrder(pendingFiles),
    pending_translations: pendingTranslations,
    generation_context: Object.keys(generation_context).length > 0 ? generation_context : undefined,
    warnings,
    validated_at: new Date().toISOString(),
    write_directly: trustedScaffold,
    next_step: nextStep,
  };
}

function makeFailure(errors, warnings) {
  // Enrich errors with educational WHY explanations
  const enrichedErrors = errors.map(err => {
    const why = ERROR_EXPLANATIONS[err.type];
    return why ? { ...err, why } : err;
  });

  return {
    ok: false,
    error_count: enrichedErrors.length,
    warning_count: warnings.length,
    errors: enrichedErrors,
    warnings,
    allowed_next_actions: buildAllowedNextActions(enrichedErrors),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * validateIntent(input, projectDir) — async, auto-detects track.
 *
 * @param {object} input  - { scaffold_output } for Track A, { intent } or bare intent for Track B
 * @param {string} projectDir - absolute path to project root
 */
export async function validateIntent(input, projectDir) {
  // Agents using the MCP stdio transport receive tool results as JSON-encoded text and may
  // pass scaffold_output as a string. Normalise it to an object before processing.
  if (input !== null && typeof input === 'object' && typeof input.scaffold_output === 'string') {
    try {
      input = { ...input, scaffold_output: JSON.parse(input.scaffold_output) };
    } catch {
      // Invalid JSON — let validation fail naturally with the string value
    }
  }

  const isScaffold = input !== null &&
    typeof input === 'object' &&
    'scaffold_output' in input;

  if (isScaffold) {
    const { changes, goal } = normalizeScaffoldInput(input.scaffold_output);
    const scaffoldTranslationKeys = extractScaffoldTranslationKeys(input.scaffold_output.files ?? []);
    const projectMap = await getProjectMap(projectDir);

    const stateResult  = validateProjectState(changes, projectMap, {
      scaffoldConflicts: input.scaffold_output.conflicts ?? [],
      projectDir,
    });
    const policyResult = validatePolicy(changes, projectMap);
    const goalWarnings = checkGoalForShopify(goal);

    const errors   = [...stateResult.errors,   ...policyResult.errors];
    const warnings = [...stateResult.warnings, ...policyResult.warnings, ...goalWarnings];

    if (errors.length > 0) return makeFailure(errors, warnings);
    return makeSuccess(changes, warnings, goal, projectMap, scaffoldTranslationKeys, { trustedScaffold: true });
  }

  // Manual track (Track B)
  // Apply coercion here so the coerced object flows into all downstream layers.
  const intent = coerceIntent((input && 'intent' in input) ? input.intent : input);

  const schemaResult = validateSchema(intent);
  if (!schemaResult.ok) return makeFailure(schemaResult.errors, []);

  const { changes, goal } = intent;

  const domainResult = validateDomain(changes);
  if (!domainResult.ok) return makeFailure(domainResult.errors, []);

  const projectMap = await getProjectMap(projectDir);

  // Layers 3 and 4 both run before checking — report all errors at once
  const stateResult  = validateProjectState(changes, projectMap, { projectDir });
  const policyResult = validatePolicy(changes, projectMap);
  const goalWarnings = checkGoalForShopify(goal);

  const errors   = [...stateResult.errors,   ...policyResult.errors];
  const warnings = [...stateResult.warnings, ...policyResult.warnings, ...goalWarnings];

  if (errors.length > 0) return makeFailure(errors, warnings);
  return makeSuccess(changes, warnings, goal, projectMap);
}
