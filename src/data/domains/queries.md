[platformOS:queries] Query files live in app/lib/queries/ — invoke via function tag, not graphql tag directly from partials.
{% function result = 'queries/my_query', arg: value %} (no `lib/` prefix — `function` paths resolve under app/lib/) — queries are read-only; all writes go through commands.
Keep queries generic and reusable; business logic belongs in commands, not queries.
For CRUD resources: run generator via bash (see schema domain header). Do NOT use generators MCP tools.
