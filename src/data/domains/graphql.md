[platformOS:graphql] Custom schema properties are NOT direct Record fields.
Access in query: property(name: "title") for one field, or properties_object for all as hash.
Record only has: id, table, created_at, updated_at, user_id, external_id — everything else needs property().
StringFilter: table: { value: "my_table" } — NEVER bare string. PropertyFilter: NO 'operator' field.
Sort: sort: [{ properties: [{ name: "field", order: DESC }] }] — ASC/DESC unquoted.
Filter inputs are always objects — wrap the value, keep the original variable type (ID! for IDs, String! for strings).
→ domain_guide({ domain: "graphql", section: "gotchas" }) and domain_guide({ domain: "graphql", section: "api" })