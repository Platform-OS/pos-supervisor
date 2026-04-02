# platformOS Liquid Tags

All platformOS-specific Liquid tags for template logic, data flow, and server-side operations. These extend standard Liquid with 25 custom tags for GraphQL execution, partial rendering, background jobs, caching, session management, error handling, and more.

## Key Purpose

platformOS Liquid tags are the primary building blocks for server-side logic. They handle:

1. **Data fetching** -- `graphql` executes queries and mutations against the database
2. **Code organization** -- `function`, `render`, `return`, `export` enable modular partial-based architecture
3. **Server operations** -- `background`, `cache`, `session`, `transaction` manage runtime behavior
4. **HTTP control** -- `redirect_to`, `response_status`, `response_headers` shape the HTTP response
5. **Error handling** -- `try/catch`, `rollback` provide robust error recovery

## When to Use

- **Fetching or mutating data** -- use `graphql` to run queries and mutations
- **Building reusable components** -- use `function` to call partials that return data, `render` for partials that produce HTML
- **Offloading slow work** -- use `background` for email sending, external API calls, heavy processing
- **Improving performance** -- use `cache` to avoid re-executing expensive queries
- **Handling user auth** -- use `sign_in`, `session` to manage authentication state
- **Atomic operations** -- use `transaction` with `rollback` for multi-step database changes
- **Error recovery** -- use `try/catch` around operations that may fail

You do NOT need custom tags when:
- Standard Liquid control flow (`if`, `for`, `unless`) is sufficient
- You need string/array manipulation (use filters instead)
- You need client-side interactivity (use JavaScript)

## How It Works

Tags execute server-side during page rendering. They run top-to-bottom within `{% liquid %}` blocks or inline `{% tag %}` syntax. Variables are LOCAL to each partial -- you must explicitly pass data between partials via arguments and return values.

```
Page loads -> Tags execute sequentially -> graphql fetches data
-> function/render call partials -> Output assembled -> Response sent
```

### Quick example: page controller pattern

```liquid
{% liquid
  function profile = 'modules/user/queries/user/current'
  graphql products = 'products/search', limit: 20
  if products.results == blank
    response_status 404
    render '404'
    break
  endif
  render 'products/index', products: products.results, user: profile
%}
```

### Important: `{% liquid %}` blocks

Use `{% liquid %}` for multi-line tag-only code. Do NOT line-wrap within the block. Each tag goes on its own line without `{% %}` delimiters:

```liquid
{% liquid
  assign x = 'hello'
  function result = 'my/partial', input: x
  render 'my/view', data: result
%}
```

## Getting Started

1. Open a page file in `app/views/pages/` or a partial in `app/views/partials/`
2. Use `{% graphql %}` to fetch data from your GraphQL queries in `app/graphql/`
3. Use `{% render %}` to delegate HTML output to partials
4. Use `{% function %}` when you need a return value from a partial
5. Wrap complex logic in `{% liquid %}` blocks for cleaner code

### Tag categories at a glance

| Category | Tags |
|----------|------|
| Data | `graphql`, `assign` (hash/array literals, key mutation) |
| Partials | `function`, `render`, `return`, `export` |
| Layout | `content_for`, `yield`, `theme_render_rc` |
| HTTP | `redirect_to`, `response_status`, `response_headers` |
| Async | `background` |
| Caching | `cache` |
| Session/Auth | `session`, `sign_in`, `context`, `spam_protection` |
| Database | `transaction`, `rollback` |
| Error handling | `try`, `catch` |
| Output | `print`, `log` |
| Forms | `form`, `include_form` |

## See Also

- [Tags Configuration](configuration.md) -- all tag parameters and options
- [Tags API](api.md) -- complete syntax reference for every tag
- [Tags Patterns](patterns.md) -- common workflows and best practices
- [Tags Gotchas](gotchas.md) -- common errors and limits
- [Tags Advanced](advanced.md) -- optimization, edge cases, advanced techniques
- [Liquid Filters](../filters/README.md) -- data transformation filters
- [Liquid Objects](../objects/README.md) -- global objects like `context`
- [GraphQL](../../graphql/README.md) -- writing the queries that `graphql` tag executes
- [Partials](../../partials/README.md) -- the templates called by `render` and `function`
