'{{name}}' does not exist.

STEP 1 — Determine the right fix.
  Fixing existing code:
    → Check if '{{name}}' is a typo. CALL project_map to see available partials — fix the path if a similar name exists.
    → If this reference is leftover from deleted/refactored code, remove the {% {{tag}} '{{name}}' %} tag entirely.
  Building new feature:
    → GOTO STEP 2 to create the missing file.
  Output came from scaffold:
    → Check scaffold output for exact path, do NOT rename scaffold files.
  For a simple form submission consider using the core module's execute helper directly:
    ```liquid
    function object = 'modules/core/commands/execute', mutation_name: 'contact_submissions/create', selection: 'record_create', object: object
    ```
    Use this when: single mutation, simple create/update/delete.
    Create custom command at app/lib/commands/ when: complex logic, multiple steps, reusable across pages.

STEP 2 — Create '{{name}}'.
  Path: {{create_path}}
  Content guide:
    partial → Liquid/HTML fragment. Start with {% doc %} @param block if it receives variables.
    command → orchestrates build → check → execute via {% function %}. Returns hash with .valid and .errors.
    query   → thin wrapper: single {% function %} call around one {% graphql %} operation. Returns result hash.
  Tip: use scaffold tool when creating a full feature — it generates the full file set with correct wiring.

STEP 3 — Re-validate.
  CALL validate_code on THIS file after fixing or creating.
  FAIL (error persists) → path mismatch. Verify: {{create_path}} exists, spelling is exact, no extra slashes.

SCAFFOLDING — Writing multiple related files in sequence?
  Pass pending_files=["{{create_path}}"] to validate_code to suppress this error for files not yet written.
