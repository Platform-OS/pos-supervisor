# platformOS Development Guide

Every rule uses MUST/MUST NOT. No information omitted. Section 0 is the mandatory
workflow — read it before touching any file.

## 0. MANDATORY WORKFLOW — Read Before Writing Any Code

**You are STRICTLY FORBIDDEN from skipping this workflow**

You MUST follow this loop for every feature. Each step produces structured output
the next step consumes — skipping any step produces invalid state that downstream
tools will reject.

1. **`project_map`** — understand what already exists. MUST be called once per session
   before any scaffold or write.
2. **`scaffold(type, name, properties, write: false)`** — generate the authoritative
   file set from platformOS-native templates. MUST use scaffold whenever a file set
   matches one of its types (crud, api, command, query, partial, page).
3. **`domain_guide(domain)` for every domain in your plan** — BEFORE drafting files.
   Skipping this is the #1 cause of broken platformOS code. `domain_guide` contains
   rules that are NOT in your training data and that differ from Shopify, Rails, and
   generic Liquid.
4. **`validate_intent` — declare your plan before touching disk.**
   Two modes, pick by what you're doing next:

   - **Mode A — hand-drafted batch (REQUIRED before manual writes).**
     Call `validate_intent({ intent: { goal, changes: [...] } })` where
     `changes` is an array of `{ path, role, action, references? }` — one
     entry per file you intend to author. The plan is the contract for the
     rest of the session.
   - **Mode B — scaffold review (OPTIONAL).**
     Call `validate_intent({ scaffold_output: <result of scaffold(write:false)> })`
     only if you want a second look at the generated set before committing.
     The default scaffold path skips this step.

   **Read the response:**
   - `ok: false` → fix `errors[].suggestion`, re-call. MUST NOT proceed.
   - `ok: true` + `write_directly: true` → Mode B; go straight to
     `scaffold(..., write: true)`.
   - `ok: true` + `write_directly: false` → Mode A; draft each file, call
     `validate_code` on the full content, then write.

   **What `pending_files` / `pending_translations` / `pending_pages` are for:**
   you can ignore them. The supervisor stores them and uses them to suppress
   false-positive `MissingPartial` / `TranslationKeyExists` errors in later
   `validate_code` / `analyze_project` calls — because those files are
   *promised* by the plan but not on disk yet. You do not pass them to any
   subsequent tool; the server merges them automatically.

   **Skipping Mode A before hand-drafted writes** is the #1 cause of phantom
   cross-reference errors: `validate_code` will flag every partial and
   translation key the plan hasn't written yet, and the agent chases those
   ghosts by deleting the references the plan needs.

   **Scope drift:** if you add, rename, or drop a file that isn't in the
   current `changes` array, re-call `validate_intent` with the updated plan
   before writing the new file.

5. **`scaffold(..., write: true)`** — writes all files to disk. If you went
   through Mode B in step 4, this runs after `write_directly: true`.
   Otherwise this is the direct follow-up to step 2. For hand-drafted edits
   (Mode A, or manual edits without scaffold), call `validate_code` per file
   and only write when validation passes — never rely on scaffold to write a
   hand-authored file.
6. **Feedback loop.** When `validate_code` returns `status !== "ok"` or
   `must_fix_before_write: true`, fix every error and re-validate. MUST NOT
   write the file to disk until validation passes.
   When debugging existing files, always read them from disk first and submit
   their actual content to `validat_code` tool.
7. Creation order matters: schema → graphql → partial → page.
8. **`analyze_project` — project-wide health check.** MUST be called:
   - **Before reporting task completion.** `validate_code` only sees one
     file at a time; cross-file damage (broken render targets, orphaned
     partials, dangling translations, schema drift) only surfaces from the
     whole-project view. A task is not done until `analyze_project` returns
     zero new errors or warnings introduced by this session.
   - **When you feel lost.** If validate_code keeps reporting errors you
     don't understand, if the same check keeps re-appearing after you
     "fixed" it, if you suspect a file you edited affected callers you
     can't see, or if `project_map` no longer matches your mental model —
     stop editing and call `analyze_project` to re-ground. It returns
     per-file error counts, the dependency graph, orphaned files, broken
     references, and schema issues for every file in `app/`. That is the
     authoritative picture of the project right now.

   `analyze_project` respects `session.pending` — files declared in a
   validated plan are not flagged as missing. You do not need to pass any
   parameters for the standard case; omit `files` to analyze the whole
   project.

   MUST NOT: skip this step before announcing "done" just because
   `validate_code` passed on the files you edited. Individual-file green
   lights do not imply project integrity.

### MUST-CALL domains (by feature type)

- **Auth code** — `domain_guide(domain: "authentication")`
- **Any form** — `domain_guide(domain: "forms")`
- **New pages** — `domain_guide(domain: "pages")`
- **New partials** — `domain_guide(domain: "partials")`
- **GraphQL ops** — `domain_guide(domain: "graphql")`
- **Any new domain** — `domain_guide(domain: "<domain>", section: "gotchas")`

### MUST NOT

- Use `{% include %}` for app code — deprecated. Use `{% render %}` or
  `{% function %}`.
- Use Shopify objects (`shop`, `cart`, `customer`, `product`, `collection`). These
  do not exist in platformOS.
- Write files to disk without calling `validate_code` on the proposed content first.
- Assume module call syntax from memory — call `module_info(name)` to get the
  authoritative live-scan API surface.
- Ignore `consult_before_writing` in a scaffold response. Every domain listed there
  MUST be consulted via `domain_guide` before step 5.

### Session-start checklist

Before your first tool call, the following are true:

- [ ] `server_status` called — confirms LSP and indexes are ready, lists
  `domain_guides` and `session_pending`.
- [ ] `load_development_guide` called (this document) — re-read if you lose
  context or are unsure which step comes next.
- [ ] `project_map` called once for full project baseline.

Proceed only when all three are checked.

---

## 1. Technology Stack

platformOS uses three primary technologies:
- **Liquid** — server-side templating language
- **GraphQL** — data operations (built-in queries/mutations only)
- **YAML** — configuration for schemas, translations, and settings

The underlying databases (PostgreSQL, ElasticSearch, Redis) MUST be accessed ONLY through GraphQL and Liquid. There is NO direct database access.

platformOS does NOT provide public GraphQL endpoints for client-side access. All GraphQL operations MUST be executed server-side using the `{% graphql %}` Liquid tag.

### Source of Truth

The official platformOS documentation is the ONLY source of truth:

| Resource | URL |
|----------|-----|
| Official Docs | documentation.platformos.com |
| GraphQL Schema | documentation.platformos.com/api/graphql/schema |
| Liquid Filters | documentation.platformos.com/api-reference/liquid/platformos-filters.md |
| Liquid Tags | documentation.platformos.com/api-reference/liquid/platformos-tags.md |
| Context Object | documentation.platformos.com/api-reference/liquid/platformos-objects.md |
| Core Module | github.com/Platform-OS/pos-module-core (README) |
| User Module | github.com/Platform-OS/pos-module-user (README) |
| Common Styling | github.com/Platform-OS/pos-module-common-styling (README) |
| Payments Module | github.com/Platform-OS/pos-module-payments (README) |
| Payments Stripe | github.com/Platform-OS/pos-module-payments-stripe (README) |
| Tests Module | github.com/Platform-OS/pos-module-tests (README) |
| Migrations | documentation.platformos.com/developer-guide/data-import-export/migrating-data.md |

You MUST NOT invent undocumented behaviors, APIs, configurations, or directory structures. When uncertain, consult documentation.

---

## 2. Directory Structure

```
project-root/
├── app/
│   ├── assets/                    # Static files (images, fonts, styles, scripts)
│   ├── views/
│   │   ├── pages/                 # Controllers — NO HTML here
│   │   ├── layouts/               # Wrapper templates
│   │   └── partials/              # Reusable template snippets
│   ├── lib/
│   │   ├── commands/              # Business logic (build -> check -> execute)
│   │   ├── queries/               # Data retrieval wrappers
│   │   ├── events/                # Event definitions
│   │   └── consumers/             # Event handlers
│   ├── schema/                    # Database table definitions (YAML)
│   ├── graphql/                   # GraphQL query/mutation files
│   ├── forms/                     # Form configurations (YAML + Liquid front matter)
│   ├── emails/                    # Email templates
│   ├── smses/                     # SMS templates
│   ├── api_calls/                 # Third-party API integrations
│   ├── translations/              # i18n content (YAML)
│   ├── authorization_policies/    # Access control rules (page/form level)
│   ├── migrations/                # One-time migration scripts
│   └── config.yml                 # Feature flags
├── modules/                       # Downloaded/custom modules (READ-ONLY)
│   └── MODULE_NAME/
│       ├── public/                # Publicly accessible files
│       └── private/               # IP-protected files (not downloadable)
└── .pos                           # Environment endpoints
```

All application files MUST reside in the `app/` directory. You MUST NOT create or modify application files outside `app/`.

The `modules/` directory is READ-ONLY. You MUST NOT edit files in `modules/` — override via documented mechanisms only.

### Module Structure Details

Modules have `public/` and `private/` subdirectories with the same internal structure:

```
modules/my_module/
├── public/
│   ├── views/
│   ├── forms/
│   ├── graphql/
│   └── assets/
└── private/
    ├── views/
    └── forms/
```

- **Public files** — accessible for preview/download after deployment
- **Private files** — IP-protected, not accessible for download
- When referencing module files, omit `public/` and `private/` from the path
- Files with the same name in both directories will conflict — do not do this

**Module file referencing:**
```liquid
{% render 'modules/my_module/header' %}
{% graphql result = 'modules/my_module/get_data' %}
{% render_form 'modules/my_module/contact_form' %}
{{ 'modules/my_module/style.css' | asset_url }}
```

**Module deletion behavior:** By default, module files are NOT deleted during `pos-cli deploy` to protect private files. To enable deletion:
```yaml
# app/config.yml
modules_that_allow_delete_on_deploy:
  - my_module
```

### File Naming Conventions

| Directory | Pattern | Example |
|-----------|---------|---------|
| Commands | `app/lib/commands/<feature>/<action>.liquid` | `app/lib/commands/questions/create.liquid` |
| Queries | `app/lib/queries/<resource>/<action>.liquid` | `app/lib/queries/articles/find.liquid` |
| Unit Tests | `app/lib/tests/<resource>/<action>_test.liquid` | `app/lib/tests/articles/create_test.liquid` |
| Pages | `app/views/pages/<resource>/<action>.liquid` | `app/views/pages/posts/show.liquid` |
| Partials | `app/views/partials/<page_or_feature>/<path>.liquid` | `app/views/partials/articles/card.liquid` |
| Assets | `app/assets/<type>/<file>` | `app/assets/images/logo.png` |
| Translations | `app/translations/<locale>.yml` | `app/translations/en.yml` |

### File Formats

| Extension | Content-Type | URL |
|-----------|--------------|-----|
| `*.liquid` or `*.html.liquid` | `text/html` | `/path` |
| `*.json.liquid` | `application/json` | `/path.json` |
| `*.js.liquid` | `application/javascript` | `/path.js` |

---

## 3. Architecture Rules

### Pages MUST Be Controllers

Pages MUST contain NO HTML, JS, or CSS. Pages MUST ONLY fetch data and delegate to partials via `render`. Each page file MUST handle exactly ONE HTTP method.

### Business Logic MUST Live in Commands

All business logic MUST reside in `app/lib/commands/`. Pages MUST delegate to commands. Commands MUST follow the build -> check -> execute pattern.

### Path Resolution

- `{% render 'blog_posts/card' %}` -> `app/views/partials/blog_posts/card.liquid`
- `{% function r = 'commands/blog_posts/create' %}` -> `app/lib/commands/blog_posts/create.liquid`
- `{% function r = 'queries/blog_posts/search' %}` -> `app/lib/queries/blog_posts/search.liquid`

The `lib/` prefix is implicit in `function` calls — do NOT include it.

### Separation of Concerns

- UI (Liquid templates) MUST be in partials and layouts
- Data operations (GraphQL) MUST be in query/mutation files
- Logic (commands) MUST be in `app/lib/commands/`

### Modules First

Every new feature MUST be built on top of existing platformOS modules (Core, User, Common-Styling, Test). You MUST NOT create duplicate models or authentication logic.

### Generators First (DEPRECATED — DO NOT USE)

You MUST prefer `pos-cli` generators (`generators-list`, `generators-run`) over manual file creation when available.

---

## 4. Pages

Pages are controllers — they handle routing, fetch data, and delegate to partials.

### Front Matter

```liquid
---
slug: products/:id
method: post
layout: application
metadata:
  title: "Product Details"
---
```

| Property | Default | Notes |
|----------|---------|-------|
| `slug` | From file path | Supports `:param`, `*wildcard`, `(/:optional)` |
| `method` | `get` | `get`, `post`, `put`, `delete` |
| `layout` | `application` | Empty string for no layout |

**You MUST NOT use `authorization_policies` in front matter — use User Module helpers instead.**
**For the home page (root /), omit the slug entirely — app/views/pages/index.liquid serves / by default.**
**For the home page omit method as it can only be `get` which is default.**
**One REST method per page**

### Dynamic Routes

| Pattern | URL | `context.params` |
|---------|-----|------------------|
| `products/:id` | `/products/123` | `{ "id": "123" }` |
| `files/*path` | `/files/a/b.txt` | `{ "path": "a/b.txt" }` |
| `search(/:q)` | `/search/books` | `{ "q": "books" }` |

### REST CRUD Convention

| HTTP Method | URL Slug | Page File | GraphQL | Purpose |
|-------------|----------|-----------|---------|---------|
| GET | `/posts/new` | `pages/posts/new.liquid` | — | Render create form |
| POST | `/posts` | `pages/posts/create.liquid` | `record_create` | Persist new resource |
| GET | `/posts/:id` | `pages/posts/show.liquid` | find query | Show single resource |
| GET | `/posts/:id/edit` | `pages/posts/edit.liquid` | find query | Render edit form |
| PUT/PATCH | `/posts/:id` | `pages/posts/update.liquid` | `record_update` | Update resource |
| DELETE | `/posts/:id` | `pages/posts/delete.liquid` | `record_delete` | Delete resource |
| GET | `/posts` | `pages/posts/index.liquid` | search query | List resources |

### CSRF Protection

Non-GET requests require a CSRF token. Without it, the platform cannot authenticate the request (user module queries return anonymous).

### GET Page Example

```liquid
---
slug: articles/:id
method: get
---
{% liquid
  function article = 'queries/articles/find', id: context.params.id

  if article == blank
    render '404'
    break
  endif

  render 'articles/show', article: article
%}
```

### POST Page Example

```liquid
---
slug: articles
method: post
---
{% liquid
  function result = 'commands/articles/create', object: context.params.article

  if result.valid
    function _ = 'modules/core/commands/session/set', key: 'sflash', value: 'app.articles.created', from: context.location.pathname
    redirect_to '/articles'
  else
    render 'articles/new', result: result
  endif
%}
```

---

## 5. Partials & Layouts

### Partials

Partials MUST NOT contain hardcoded user-facing text — always use translations (`{{ 'app.key' | t }}`).

Partials MUST NOT have underscore-prefixed filenames.

The render path maps: `render 'path/name'` -> `app/views/partials/path/name.liquid`.

### Layouts

The default layout is `application`. Set `layout: ""` (empty string) in front matter for no layout.

---

## 6. Commands (Business Logic)

All business logic MUST be encapsulated in commands following the build -> check -> execute pattern.

### Main Command

```liquid
{% doc %}
  @param object {object} - Article data
{% enddoc %}

{% liquid
  function object = 'commands/articles/create/build', object: object
  function object = 'commands/articles/create/check', object: object

  if object.valid
    function object = 'modules/core/commands/execute', mutation_name: 'articles/create', selection: 'record', object: object
  endif

  return object
%}
```

### Build Stage

Normalizes and structures input data:

```liquid
{% doc %}
  @param object {object} - form params
{% enddoc %}

{% liquid
  assign object['title'] = object.title
  assign object['body'] = object.body

  return object
%}
```

### Check Stage

Validates the built object:

```liquid
{% doc %}
  @param object {object} - form params
{% enddoc %}

{% liquid
  assign c = '{ "errors": {}, "valid": true }' | parse_json

  function c = 'modules/core/lib/validations/presence', c: c, field_name: 'title', object: object
  function c = 'modules/core/lib/validations/presence', c: c, field_name: 'body',  object: object

  assign object = object | hash_merge: valid: c.valid, errors: c.errors

  return object
%}
```

### ~~Alternative Core Module Syntax~~ (DEPRECATED — DO NOT USE)

> **Warning:** `modules/core/commands/build` and `modules/core/commands/check` do NOT exist in the core module. Only `modules/core/commands/execute` is a shared core command. Build and check MUST be per-model files (e.g., `commands/articles/create/build.liquid`, `commands/articles/create/check.liquid`).

```liquid
{% comment %} WRONG — these partials do not exist: {% endcomment %}
{% function object = 'modules/core/commands/build', object: object %}
{% function object = 'modules/core/commands/check', object: object,
  validators: '[{"name": "presence", "property": "title"}]'
%}

{% comment %} CORRECT — only execute is shared: {% endcomment %}
{% if object.valid %}
  {% function object = 'modules/core/commands/execute',
    mutation_name: 'products/create', selection: 'record', object: object
  %}
{% endif %}

{% return object %}
```

### Events

```liquid
{% comment %} Publish an event {% endcomment %}
{% function _ = 'modules/core/commands/events/publish', type: 'order_created', object: order %}

{% comment %} Consumer: app/lib/consumers/order_created/send_email.liquid {% endcomment %}
{% graphql _ = 'emails/send_confirmation', email: event.object.email %}
```

All inputs MUST be validated in commands before persisting.

---

## 7. GraphQL

GraphQL MUST be called from pages, query wrappers (`app/lib/queries/`), or commands (via `modules/core/commands/execute`). You MUST NOT call GraphQL from partials/views. Raw GraphQL MUST NOT appear in pages — use `.graphql` files exclusively.

### Query Wrapper Pattern

```liquid
{% doc %}
  @param id {string} - Article ID
{% enddoc %}

{% liquid
  graphql result = 'articles/find', id: id
  return result.records.results | first
%}
```

### Search with Pagination

```graphql
query search($page: Int = 1, $keyword: String) {
  records(
    page: $page
    per_page: 20
    filter: {
      table: { value: "article" }
      properties: [{ name: "title", contains: $keyword }]
    }
    sort: { created_at: { order: DESC } }
  ) {
    total_pages
    results {
      id
      title: property(name: "title")
      body: property(name: "body")
    }
  }
}
```

All list queries MUST support `per_page` and `page` arguments for pagination.

### Find by ID

```graphql
query find($id: ID!) {
  records(
    per_page: 1
    filter: {
      id: { value: $id }
      table: { value: "article" }
    }
  ) {
    results {
      id
      title: property(name: "title")
    }
  }
}
```

### Related Records (Avoids N+1)

```graphql
results {
  id
  # belongs-to (single)
  author: related_record(table: "user", join_on_property: "user_id") {
    email
  }
  # has-many
  comments: related_records(table: "comment", join_on_property: "id", foreign_property: "article_id") {
    body: property(name: "body")
  }
}
```

### Upload Property

```graphql
image: property_upload(name: "image") { url }
```

### Mutations

All mutations MUST alias the result as `record:` so `modules/core/commands/execute` can extract it with `selection: 'record'`:

- `record: record_create(record: { table: "...", properties: [...] }) { id }`
- `record: record_update(id: $id, record: { properties: [...] }) { id }`
- `record: record_delete(table: "...", id: $id) { id }` — **`table` is required**, without it: runtime error "You must specify table"

### Soft Delete vs Hard Delete

**Soft delete** (default) — sets `deleted_at` timestamp:
```graphql
mutation {
  record_delete(table: "article", id: "123") {
    id
    deleted_at  # Timestamp is set
  }
}
```

**Hard delete** (permanent) — requires `hard_delete: true`:
```graphql
mutation {
  record_delete(table: "article", id: "123", hard_delete: true) {
    id
  }
}
```

Soft-deleted records can be queried using the `deleted_at` filter:
```graphql
query {
  records(
    filter: {
      table: { value: "article" }
      deleted_at: { exists: true }
    }
  ) {
    results { id deleted_at }
  }
}
```

### Pagination Component

```liquid
{% graphql result = 'products/search', page: context.params.page %}
{% render 'modules/common-styling/pagination', total_pages: result.records.total_pages %}
```

---

## 8. Schema

Schema files define database tables in YAML at `app/schema/`.

```yaml
# app/schema/article.yml
name: article
properties:
  - name: title
    type: string
  - name: body
    type: text
  - name: published_at
    type: datetime
  - name: image
    type: upload
    options:
      public: true
      versions:
        - name: thumbnail
          resize: "200x200>"
        - name: medium
          resize: "800x600>"
```

### Property Types

`string`, `text`, `integer`, `float`, `boolean`, `datetime`, `date`, `array`, `upload`

### Upload Options

| Option | Type | Description |
|--------|------|-------------|
| `public` | boolean | `true` = public URL, `false` = requires auth |
| `max_size` | integer | Max file size in bytes |
| `versions` | array | Image resize versions |
| `extensions` | array | Allowed file extensions |

Version resize syntax:
- `100x100>` — Resize only if larger (downscale only)
- `100x100<` — Resize only if smaller (upscale only)
- `100x100#` — Exact dimensions (may crop)
- `100x100^` — Minimum dimensions (may crop)
- `100x100` — Fit within dimensions

### Reserved Names (MUST NOT Use)

The following names are reserved by platformOS and MUST NOT be used as custom table or property names:

**System fields (automatically created on every record):**
- `id` — Record UUID
- `created_at` — Creation timestamp
- `updated_at` — Last update timestamp
- `deleted_at` — Soft delete timestamp
- `type_name` — Table name
- `properties` — Property container

**Reserved table names:**
- `user`, `users` — Built-in User table
- `session`, `sessions` — Session management
- `record`, `records` — Record operations
- `constant`, `constants` — System constants
- `table`, `tables` — Table metadata
- `background_job`, `background_jobs` — Background job system

---

## 9. Liquid Reference

### Tags

```liquid
{% graphql result = 'query_name', arg: value %}
{% function result = 'path/to/partial', arg: value %}
{% render 'partial', var: value %}
{% doc %} @param name {Type} - description {% enddoc %}
{% return result %}
{% export my_var, namespace: 'my_ns' %}
{% parse_json data %}{"key": "value"}{% endparse_json %}
{% redirect_to '/path', status: 302 %}
{% session key = value %}
{% log variable, type: 'debug' %}
{% cache key: 'key_name', expire: 3600 %}...{% endcache %}
{% background source_name: 'job_name', priority: 'low', delay: 5.0, max_attempts: 3 %}...{% endbackground %}
{% content_for_layout %}
{% theme_render_rc 'modules/common-styling/toasts' %}
```

**`include` is DEPRECATED** — use `render` (UI partials) or `function` (logic partials) instead. Some module APIs still use `include` as their calling convention (follow those docs as-is).

### Output

```liquid
{{ variable }}              <!-- Escaped (safe) -->
{{ variable | html_safe }}  <!-- Unescaped (careful!) -->
{% print variable %}        <!-- Unescaped (careful!) -->
```

### Common Filters

- **Arrays:** `array_add`, `array_map`, `array_sort_by`, `array_group_by`
- **Hashes:** `hash_merge`, `hash_dig`, `hash_keys`
- **Dates:** `add_to_time`, `localize`, `is_date_in_past`
- **Validation:** `is_email_valid`, `is_json_valid`
- **Encoding:** `json`, `base64_encode`, `url_encode`

### Coding Standards

You MUST NOT line-wrap statements within `{% liquid %}` blocks. Each statement MUST be on a single line.

**Correct:**
```liquid
{% liquid
  assign filtered = products | where: 'available', true | map: 'title' | first
  assign price = product | where: 'id', pid | map: 'price' | first
%}
```

**WRONG (causes syntax errors):**
```liquid
{% liquid
  assign filtered = products
    | where: 'available', true
    | map: 'title'
    | first
%}
```

---

## 10. Global Context

**All global objects MUST use the `context.` prefix.** Using bare names (e.g., `params` instead of `context.params`, `page` instead of `context.page`) will fail silently or produce wrong results.

| Property | Description |
|----------|-------------|
| `context.params` | HTTP parameters (query string + body) |
| `context.session` | Server-side session storage |
| `context.location` | URL info (`pathname`, `search`, `host`) |
| `context.environment` | `staging` or `production` |
| `context.is_xhr` | `true` for AJAX requests |
| `context.authenticity_token` | CSRF token |
| `context.constants` | Environment constants (hidden from `{{ context }}` for security) |
| `context.page.metadata` | Page metadata from front matter |

### context.current_user

`context.current_user` is a documented platformOS object that returns basic data of the currently logged-in user:

```liquid
{{ context.current_user.id }}         # User UUID
{{ context.current_user.email }}      # User email
{{ context.current_user.first_name }} # First name
{{ context.current_user.last_name }}  # Last name
{{ context.current_user.slug }}       # User slug
{{ context.current_user.properties }} # Custom properties hash
```

Returns `null` if no user is logged in.

For projects using pos-module-user, prefer `modules/user/queries/user/current` as it provides additional normalized user data and role information. Use `context.current_user` for simple checks (e.g., checking if anyone is logged in) and the User Module query for full user data operations.

---

## 11. User Module (Authentication & Authorization)

You MUST use the User Module for all authentication and authorization. You MUST NOT duplicate login logic. You MUST NOT customize auth routes unless explicitly requested.

### Built-in Roles

- **Anonymous** — unauthenticated users
- **Authenticated** — any logged-in user
- **Superadmin** — bypasses ALL permission checks

### Authorization Helpers

```liquid
{% function profile = 'modules/user/queries/user/current' %}

{% comment %} Check permission (returns true/false) {% endcomment %}
{% function can = 'modules/user/helpers/can_do', requester: profile, do: 'article.create' %}

{% comment %} Enforce permission (403 if denied) — uses include (module API convention) {% endcomment %}
{% include 'modules/user/helpers/can_do_or_unauthorized', requester: profile, do: 'admin.view', redirect_anonymous_to_login: true %}

{% comment %} Redirect if denied — uses include (module API convention) {% endcomment %}
{% include 'modules/user/helpers/can_do_or_redirect', requester: profile, do: 'orders.view', return_url: '/login' %}
```

> Note: These auth helpers use `include` because they need access to the caller's scope to halt execution. This is the module's documented API — do not replace with `render` or `function`.

### Custom Permissions

Override `modules/user/public/lib/queries/role_permissions/permissions.liquid`:

```bash
mkdir -p app/modules/user/public/lib/queries/role_permissions
cp modules/user/public/lib/queries/role_permissions/permissions.liquid \
   app/modules/user/public/lib/queries/role_permissions/permissions.liquid
```

Define roles:
```liquid
{% parse_json data %}
{
  "admin": ["admin.view", "users.manage"],
  "editor": ["article.create", "article.update"],
  "superadmin": []
}
{% endparse_json %}
{% return data %}
```

### Native Authorization Policies (Optional)

platformOS also provides `authorization_policies/` for page and form-level access control. These work independently of the User Module and are useful for simple checks:

**File:** `app/authorization_policies/requires_login.liquid`
```liquid
---
name: requires_login
redirect_to: /sign-in
flash_alert: Please sign in to access this page
---
{% if context.current_user %}true{% else %}false{% endif %}
```

**Usage in page front matter:**
```liquid
---
slug: admin/dashboard
authorization_policies:
  - requires_login
---
```

For projects using pos-module-user, prefer the module's authorization helpers. Use native authorization policies only for simple use cases not covered by the module.

---

## 12. Core Module

You MUST use pos-module-core for commands, events, and validators.

---

## 13. Common Styling

You MUST NOT use Tailwind, Bootstrap, or custom CSS frameworks. You MUST use `pos-*` prefixed classes from the common-styling module. Check `/style-guide` on your instance for available components.

### Setup

```liquid
{% comment %} In <head> {% endcomment %}
{% render 'modules/common-styling/init' %}
```
```html
<html class="pos-app">
```

### File Upload Component

```liquid
{% render 'modules/common-styling/forms/upload',
  id: 'image', presigned_upload: presigned, name: 'image',
  allowed_file_types: ['image/*'], max_number_of_files: 5
%}
```

---

## 14. Translations (i18n)

You MUST NOT hardcode user-facing text in partials. You MUST always use `{{ 'app.key' | t }}` and define translations in `app/translations/`.
The YAML file requires top-level language key:

```
en:
  app:
    contact_form:
      title: "..."
```

---

## 15. Forms

You MUST use HTML `<form>` tags. You MUST NOT use `{% form %}`.

Forms MUST include the CSRF token:
```html
<input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
```

For PUT/DELETE, forms MUST use POST with a `_method` hidden field:
```html
<form action="/posts/{{ post.id }}" method="post">
  <input type="hidden" name="_method" value="delete">
  <input type="hidden" name="authenticity_token" value="{{ context.authenticity_token }}">
  <button type="submit">Delete</button>
</form>
```

Form fields MUST use bracket notation for resource binding:
```html
<input name="resource[field]" value="...">
```

Access in page: `context.params.resource`

HTML forms submit checkbox values as "on" (string), but GraphQL expects boolean field to be Boolean type, not string.

### Form Configurations (app/forms/)

platformOS also supports form configurations in `app/forms/` that define validation, callbacks, and processing. These are YAML + Liquid files:

```liquid
---
name: contact_form
resource: contact_message
resource_owner: anyone
redirect_to: /contact/thank-you
flash_notice: Message sent successfully!
fields:
  properties:
    name:
      validation:
        presence: true
    email:
      validation:
        presence: true
        email: true
---

{% form %}
  <input name="{{ form.fields.properties.name.name }}" value="{{ form.fields.properties.name.value }}">
  <input name="{{ form.fields.properties.email.name }}" value="{{ form.fields.properties.email.value }}">
  <button>Submit</button>
{% endform %}
```

The `{% form %}` tag automatically generates the `<form>` element with correct attributes and CSRF token. It also provides the `form` object with field metadata.

When using the Core Module command pattern (recommended), use HTML forms with bracket notation. The `{% form %}` tag is available for simpler use cases.

### Form Validation Error Display

```liquid
{% if form.fields.properties.name.errors %}
  <span class="error">{{ form.fields.properties.name.errors }}</span>
{% endif %}
```

### Validation Types

| Validation | Description |
|------------|-------------|
| `presence: true` | Field is required |
| `email: true` | Must be valid email format |
| `uniqueness: true` | Must be unique across records |
| `length: { minimum: 5, maximum: 100 }` | String length constraints |
| `numericality: { greater_than: 0 }` | Numeric range constraints |
| `confirmation: true` | Must match `_confirmation` field |
| `url: true` | Must be valid URL |

---

## 16. Constants & Credentials

You MUST NOT hardcode API keys, secrets, or environment-specific URLs. You MUST use `context.constants`.

### Setting Constants

**Via CLI:**
```bash
pos-cli constants set --name STRIPE_SK_KEY --value "sk_test_..." dev
pos-cli constants set --name OPENAI_API_KEY --value "sk-..." dev
pos-cli constants set --name API_BASE_URL --value "https://api.example.com" dev
```

**Via GraphQL:**
```graphql
mutation {
  constant_set(name: "STRIPE_SK_KEY", value: "sk_test_...") {
    name
  }
}
```

### Accessing Constants in Liquid

Constants are hidden from `{{ context }}` for security. You MUST access them explicitly:
```liquid
{{ context.constants.STRIPE_SK_KEY }}
{{ context.constants.API_BASE_URL }}
```

### Naming Conventions

| Use Case | Example |
|----------|---------|
| API keys | `STRIPE_SK_KEY`, `OPENAI_API_KEY`, `TWILIO_API_SECRET` |
| API URLs | `API_BASE_URL` |
| Feature flags | `FEATURE_NEW_CHECKOUT_ENABLED` |

Staging constants SHOULD be initialized in migrations so new developers and tests can use test credentials automatically.

---

## 17. Flash Messages & Toasts

### Layout Setup (before `</body>`)

```liquid
{% liquid
  function flash = 'modules/core/commands/session/get', key: 'sflash'
  if context.location.pathname != flash.from or flash.force_clear
    function _ = 'modules/core/commands/session/clear', key: 'sflash'
  endif
  render 'modules/common-styling/toasts', params: flash
%}
```

### Liquid Usage

```liquid
{% liquid
  function _ = 'modules/core/commands/session/set', key: 'sflash', value: 'app.order.confirmed', from: context.location.pathname
  redirect_to '/orders'
%}
```

### JavaScript Usage

```javascript
new pos.modules.toast('success', 'Saved!');
new pos.modules.toast('error', 'Failed');
```

---

## 18. Notifications (Email/SMS)

```liquid
{% comment %} app/emails/order_confirmation.liquid {% endcomment %}
---
to: {{ data.email }}
from: shop@example.com
subject: "Order #{{ data.order_id }}"
layout: mailer
---
<p>Thank you for your order!</p>
```

Emails SHOULD be sent asynchronously using events + consumers.

---

## 19. Payments (Stripe)

### Install

```bash
pos-cli modules install payments && pos-cli modules install payments_stripe
pos-cli constants set --name stripe_sk_key --value "sk_test_..." dev
```

### Create Transaction

```liquid
{% function transaction = 'modules/payments/commands/transactions/create',
  gateway: 'stripe', email: email, line_items: items,
  success_url: '/thank-you', cancel_url: '/cart'
%}
{% function url = 'modules/payments/queries/pay_url', transaction: transaction %}
{% redirect_to url, status: 303 %}
```

Handle events via consumers: `payments_transaction_succeeded`, `payments_transaction_failed`

**Test card:** `4242 4242 4242 4242`, any future date, any CVC.

---

## 20. Background Jobs

Background jobs run code asynchronously outside the HTTP request cycle.

### Syntax

```liquid
{% background
  source_name: 'send_welcome_email',
  delay: 5.0,
  priority: 'default',
  max_attempts: 3
%}
  {% graphql user = 'users/find', id: user_id %}
  {% graphql _ = 'emails/send_welcome', email: user.email %}
{% endbackground %}
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `source_name` | String | — | Human-readable job identifier |
| `priority` | String | `default` | `high` (1min), `default` (5min), `low` (60min) |
| `delay` | Float | 0 | Minutes to delay execution |
| `max_attempts` | Integer | 1 | Retry count (1-5) |

### CRITICAL: Variable Scope

Only variables **explicitly passed** to the background tag are available inside it. The `context` object is available by default but with limitations.

**WRONG:**
```liquid
{% assign user_id = context.current_user.id %}
{% background source_name: 'job' %}
  {{ user_id }}  {# nil — not passed #}
{% endbackground %}
```

**CORRECT:**
```liquid
{% assign user_id = context.current_user.id %}
{% background source_name: 'job', user_id: user_id %}
  {{ user_id }}  {# Works! Explicitly passed #}
{% endbackground %}
```

### Priority Levels & Execution Limits

| Priority | Max Execution | Use Case |
|----------|---------------|----------|
| `high` | 1 minute | Critical, time-sensitive tasks |
| `default` | 5 minutes | Standard operations |
| `low` | 60 minutes | Heavy processing, batch jobs |

### Monitoring Jobs

```graphql
query {
  background_jobs(
    per_page: 20
    sort: [{ created_at: { order: DESC } }]
  ) {
    results {
      id
      source_name
      priority
      attempts
      max_attempts
      created_at
      started_at
      completed_at
      failed_at
      error_message
    }
  }
}
```

### Payload Limits

Keep background job payloads under 100KB. For large data, pass references (IDs) and fetch data inside the job:

```liquid
{% background record_id: record_id, source_name: 'process' %}
  {% graphql record = 'records/find', id: record_id %}
  {# Process the record #}
{% endbackground %}
```

---

## 21. Migrations

Migrations execute code outside the regular application cycle — useful for seeding data, initializing constants, and database modifications.

### File Structure

```
app/migrations/
├── 20240115120000_seed_initial_data.liquid
├── 20240116093000_add_default_categories.liquid
└── 20240120150000_init_staging_constants.liquid
```

Files MUST be named with UTC timestamp prefix for chronological execution.

### Creating a Migration

```bash
pos-cli migrations generate dev init_staging_constants
# Creates: app/migrations/YYYYMMDDHHMMSS_init_staging_constants.liquid
```

### Example: Initialize Staging Constants

```liquid
{% liquid
  if context.environment == 'staging'
    graphql _ = 'constants/set', name: 'STRIPE_SK_KEY', value: 'sk_test_example123'
    graphql _ = 'constants/set', name: 'API_BASE_URL', value: 'https://api-staging.example.com'
  endif
%}
```

### Example: Seed Data

```liquid
{% parse_json categories %}
["Electronics", "Clothing", "Books"]
{% endparse_json %}

{% for category in categories %}
  {% graphql _ = 'categories/create', name: category %}
{% endfor %}
```

### Running Migrations

- **Automatic:** Pending migrations run on `pos-cli deploy`
- **Manual:** `pos-cli migrations run TIMESTAMP dev`

### Migration States

- **pending** — not yet executed (runs on next deploy)
- **done** — successfully completed (will not run again)
- **error** — failed (can edit and retry)

### Migration Best Practices

1. **Make migrations idempotent** — running twice should not cause errors:
```liquid
{% graphql record = 'records/find', id: record_id %}
{% unless record.properties.status %}
  {% graphql _ = 'records/update', id: record_id, status: 'active' %}
{% endunless %}
```

2. **Use background jobs for large migrations:**
```liquid
{% background source_name: 'data_migration', priority: 'low' %}
  {% graphql records = 'records/list_all' %}
  {% for record in records.records.results %}
    {# Process each record #}
  {% endfor %}
{% endbackground %}
```

3. **Test migrations on staging first**
4. **Log progress:**
```liquid
{% log 'Migration started' %}
{% log 'Processed 50 records' %}
```

For large data imports, use Data Import/Export instead of migrations.

---

## 22. Data Import/Export

### Exporting Data

```bash
# Export all data
pos-cli data export staging --path=./export.json

# Export specific tables
pos-cli data export staging --tables=products,orders --path=./products.json
```

### Importing Data

```bash
# Import data
pos-cli data import staging ./export.json

# Import with transformations
pos-cli data import staging ./data.json --transform=./transform.js
```

### Export Format

```json
{
  "users": [
    {
      "id": "123",
      "email": "user@example.com",
      "properties": { "first_name": "John" }
    }
  ],
  "records": {
    "product": [
      {
        "id": "456",
        "properties": { "name": "Widget", "price": 19.99 }
      }
    ]
  }
}
```

### Cleaning Instance Data

```bash
# WARNING: Deletes all data!
pos-cli data clean staging

# Clean specific tables
pos-cli data clean staging --tables=products,orders
```

---

## 23. JSON Documents

JSON Documents provide schemaless data storage for flexible, document-based data.

**Use Cases:** Configuration data, unstructured content, temporary data storage.

### Creating JSON Documents

```graphql
mutation {
  json_document_create(
    document: {
      name: "site_config"
      content: "{\"theme\": \"dark\", \"features\": [\"blog\", \"shop\"]}"
    }
  ) {
    id
    name
    content
  }
}
```

### Querying

```graphql
query {
  json_document(name: "site_config") {
    id
    name
    content
  }

  json_documents(per_page: 10) {
    results { id name content }
  }
}
```

### Updating

```graphql
mutation {
  json_document_update(
    name: "site_config"
    document: { content: "{\"theme\": \"light\"}" }
  ) {
    id
    content
  }
}
```

### Using in Liquid

```liquid
{% graphql config = 'json_documents/find', name: 'site_config' %}
{% assign settings = config.json_document.content | parse_json %}
Theme: {{ settings.theme }}
```

---

## 24. Activity Feeds

Activity Feeds implement the W3C Activity Streams 2.0 specification for tracking user activities.

**Characteristics:** Activities are immutable (append-only), each has a unique UUID.

### Creating Activities

```graphql
mutation {
  activity_create(
    activity: {
      type: "Join"
      actor: { type: "Person", id: "User.123", name: "John" }
      object: { type: "Group", id: "Group.456" }
    }
  ) {
    id
    uuid
  }
}
```

### Publishing to Feeds

```graphql
mutation {
  feed_publish(
    feed_id: "user_123_notifications"
    activity_uuid: "abc-123-uuid"
  ) { id }
}
```

### Querying Feeds

```graphql
query {
  feeds(feed_id: "user_123_notifications", per_page: 20) {
    total_entries
    results { id uuid type actor object target created_at }
  }
}
```

### Common Activity Types

| Type | Description |
|------|-------------|
| `Create` | Created something |
| `Update` | Updated something |
| `Delete` | Deleted something |
| `Join` | Joined a group |
| `Follow` | Started following |
| `Like` | Liked content |
| `Comment` | Commented |
| `Approve` | Approved a request |

---

## 25. AI Embeddings

platformOS supports AI embeddings for semantic search and similarity matching.

### Creating Embeddings

```graphql
mutation {
  embedding_create(
    embedding: {
      name: "product_description"
      value: "High-quality wireless headphones"
      target_id: "product_123"
      target_type: "Product"
    }
  ) {
    id
    vector
  }
}
```

### Semantic Search

```graphql
query {
  embeddings_search(
    query: "wireless audio devices"
    limit: 10
    threshold: 0.7
  ) {
    results {
      id
      target_id
      similarity
      value
    }
  }
}
```

### Parameters

| Parameter | Description |
|-----------|-------------|
| `name` | Embedding type identifier |
| `value` | Text to embed |
| `target_id` | Associated entity ID |
| `target_type` | Associated entity type |

---

## 26. Testing

Tests MUST go in `app/lib/tests/*_test.liquid`. Testing ONLY works in staging/development.

Every new feature MUST have unit tests for commands.

```liquid
{% function result = 'commands/products/create', title: "Test" %}
{% function contract = 'modules/tests/assertions/valid_object', contract: contract, object: result %}
{% function contract = 'modules/tests/assertions/equal', contract: contract, given: result.title, expected: "Test" %}
{% return contract %}
```

Run tests: `/_tests/run` in browser, or `pos-cli test run staging` for CI.

---

## 27. CLI Commands

```bash
# Deployment
pos-cli deploy dev

# Sync (MUST sync every file after modification)
pos-cli sync dev

# Logs
pos-cli logs dev

# Linting (MUST run after EVERY file change)
platformos-check

# Run Liquid inline
pos-cli exec liquid dev '<code>'

# Run GraphQL inline
pos-cli exec graphql dev '<query>'

# Tests
pos-cli test run staging

# Modules
pos-cli modules install <name>
pos-cli modules download <name>

# Constants
pos-cli constants set --name KEY --value "value" dev

# Generate CRUD
pos-cli generate run modules/core/generators/crud <resource> <props> --include-views

# Migrations
pos-cli migrations generate dev <name>
pos-cli migrations run TIMESTAMP dev

# Data Import/Export
pos-cli data export staging --path=./export.json
pos-cli data import staging ./data.json
pos-cli data clean staging
```

---

## 28. Modules Reference

| Module | Install | Purpose | Required |
|--------|---------|---------|----------|
| `core` | Required | Commands, events, validators | YES |
| `user` | Required | Auth, RBAC, OAuth2 | YES |
| `common-styling` | Required | CSS, components | YES |
| `tests` | Optional | Testing framework | YES (for testing) |
| `payments` + `payments_stripe` | Optional | Stripe payments | No |
| `chat` | Optional | WebSocket messaging | No |
| `openai` | Optional | OpenAI integration | No |

---

## 29. Forbidden Behaviors

You MUST NOT:
- Edit files in `./modules/` (read-only)
- Break long lines in `{% liquid %}` blocks (causes syntax errors)
- Invent Liquid tags, filters, or GraphQL types that do not exist
- Bypass security (CSRF tokens, authorization)
- Access databases directly outside GraphQL
- Deploy without running `platformos-check`
- Sync files outside `./app/`
- Hardcode API keys, secrets, or environment-specific URLs
- Hardcode user-facing text in partials (use translations)
- Put HTML, JS, or CSS in page files
- Call GraphQL from partials
- Put raw GraphQL in pages (use `.graphql` files)
- Create or modify application files outside the `app/` directory
- Use reserved names (`id`, `created_at`, `deleted_at`, `type_name`, `properties`) as custom property/table names
- Use more than one HTTP methods per page:
```
#Never try to handle POST + rendering + redirect in the same root page. Keep it clean:
/ → GET → renders page
/contact (or similar) → POST → processes + redirects
```
---

## 30. Pre-Flight Checklist

Before every change, verify:

- [ ] No underscore prefix in partial filenames
- [ ] `render 'path/name'` maps to `app/views/partials/path/name.liquid`
- [ ] Pages have ONE HTTP method each
- [ ] No raw GraphQL in pages (use `{% graphql %}` tag with `.graphql` files)
- [ ] No HTML/JS/CSS in pages
- [ ] No hardcoded text in partials (use translations)
- [ ] `platformos-check` passes with 0 errors
- [ ] Every file synced after modification
- [ ] All list queries support pagination (`per_page`, `page`)
- [ ] All inputs validated in commands before persisting
- [ ] CSS/JS minified, `asset_url` used for cache busting

### Asset URL Usage

```liquid
{{ 'images/img.png' | asset_url }}
```
