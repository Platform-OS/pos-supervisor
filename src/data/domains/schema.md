[platformOS:schema] Schema files define table structure — they are NOT GraphQL types directly.
Access custom properties in GraphQL via properties_object and in Liquid via result.properties_object.field_name.
Use lookup or domain_guide for schema reference to find the correct query/mutation for your table.
⚠️ CRUD GENERATOR — MUST NOT manually create CRUD files. Run via bash (NOT MCP tools — they are broken):
  pos-cli generate run modules/core/generators/crud resource_name title:string body:text published_at:datetime --include-views
  Args: first arg is resource name (singular, lowercase, underscored), remaining args are properties as name:type pairs.
  Property types: string, text, integer, float, boolean, datetime, date, array, upload.
  Flag: --include-views generates pages + partials + translations; omit for API-only.
  Generated files: schema, graphql (create/update/delete/search), commands (create/update/delete with build/check),
    queries (find/search), pages (index/show/new/create/edit/update/delete), partials, translations.
  DO NOT use generators-run, generators-list, or generators-help MCP tools. Use bash.
  After generation: review generated files, add {% doc %} blocks, customize as needed.
