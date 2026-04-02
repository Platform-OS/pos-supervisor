# platformOS `config.yml`

```
CONFIG_FILE: app/config.yml

FLAGS
cookies_same_site=Lax            # cookie SameSite: Lax|Strict|none
default_layout=application       # default page layout
do_not_add_return_to_to_authorization_policies=false  # disable auto return_to on auth redirect
escape_output_instead_of_sanitize=true  # escape output instead of HTML sanitize
graphql_argument_type_mismatch_mode=error  # GraphQL arg mismatch: warning|error|ignore
html_format_exact_match=false    # if true only exact page formats resolve
liquid_add_old_variables=false   # enable deprecated Liquid globals
liquid_check_mode=error          # static Liquid analysis: warning|error
liquid_raise_mode=true           # runtime Liquid errors -> HTTP 500
maintenance={enabled:false,password_constant:MAINTENANCE_PASSWORD,partial:maintenance}
modules_that_allow_delete_on_deploy=[]
redirect_trailing_slash=false    # redirect /page/ -> /page
require_table_for_record_delete_mutation=true
safe_translate=true              # escape vars in translate filter (XSS protection)
skip_elasticsearch=false         # disable ES indexing if keyword search unused
slug_exact_match=true            # strict slug match only
sync_assets=false                # sync admin_assets with deploy manifest
sync_translations=false          # sync/delete translations on deploy
translation_keys_to_ignore=[]
validations_for_graph_queries=false  # additional GraphQL consistency checks
websockets_require_csrf_token=true
high_performance_sql_filtering=false # optimized SQL filtering (may break legacy)
```

---

# Recommended Production Config

```
escape_output_instead_of_sanitize=true
graphql_argument_type_mismatch_mode=error
liquid_add_old_variables=false
liquid_check_mode=error
liquid_raise_mode=true
require_table_for_record_delete_mutation=true
safe_translate=true
skip_elasticsearch=true
slug_exact_match=true
sync_assets=true
sync_translations=true
websockets_require_csrf_token=true
high_performance_sql_filtering=true
```

---

# Maintenance Mode (summary)

```
maintenance.enabled=true
maintenance.password_constant=MAINTENANCE_PASSWORD
maintenance.partial=maintenance
```

Behavior:

* shows `partials/maintenance.html.liquid`
* password POST → `/_maintenance`
* validated against `context.constants[MAINTENANCE_PASSWORD]`
* success stored in session
* applies only to **valid pages + GET requests**

---

If you want, I can also produce an **even more aggressive “LLM dictionary format” (~3–4× smaller)** used in **high-density RAG systems** where config docs must fit into **<200 tokens**.

