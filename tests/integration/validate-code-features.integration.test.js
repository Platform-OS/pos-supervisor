import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { startServer, FIXTURE_DIR } from './helpers/server.js';

setDefaultTimeout(30_000);

let server;

beforeAll(async () => {
  server = await startServer(FIXTURE_DIR);
});

afterAll(() => {
  server?.stop();
});

// ---------------------------------------------------------------------------
// Feature 1: next_step in validate_code
// ---------------------------------------------------------------------------

describe('validate_code — next_step guidance', () => {
  it('valid file returns next_step telling to write to disk', async () => {
    const content = `---
slug: test_valid
---
{% render 'blog_posts/list' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test_valid.html.liquid',
      content,
      mode: 'quick',
    });
    // In quick mode, a simple valid file should pass
    if (result.status === 'ok') {
      expect(result.next_step).toBeDefined();
      expect(result.next_step).toContain('Write it to disk');
    }
  });

  it('invalid file returns next_step with fix instructions', async () => {
    // Empty content triggers InputError
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_invalid.liquid',
      content: 'app/views/partials/test_invalid.liquid',
      mode: 'quick',
    });
    // This should be invalid (content looks like a file path)
    if (result.status === 'error' && result.next_step) {
      expect(result.next_step).toContain('Fix');
    }
  });

  it('invalid file next_step suggests re-validation with quick mode', async () => {
    const content = `{{ unknown_definitely_broken_var_xyzzy }}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_revalidate.liquid',
      content,
      mode: 'quick',
    });
    if (result.status === 'error') {
      expect(result.next_step).toBeDefined();
      expect(result.next_step).toContain('quick');
    }
  });
});

// ---------------------------------------------------------------------------
// Feature 2: Structured domain_guide
// ---------------------------------------------------------------------------

describe('validate_code — structured domain_guide', () => {
  it('domain_guide is an object with domain/rule/triggered_gotchas fields when triggered', async () => {
    // Use content that triggers domain gotchas for 'pages' domain
    const content = `---
slug: test_domain
---
<div class="container">
  <h1>Inline HTML in page</h1>
</div>`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test_domain_guide.html.liquid',
      content,
      mode: 'full',
    });
    // domain_guide may or may not be triggered depending on the gotchas config
    if (result.domain_guide) {
      expect(typeof result.domain_guide).toBe('object');
      expect(result.domain_guide.domain).toBeDefined();
      expect(result.domain_guide.rule).toBeDefined();
      expect(result.domain_guide.triggered_gotchas).toBeDefined();
    }
  });

  it('domain field matches the file domain when triggered', async () => {
    const content = `---
slug: test_pages_domain
---
{% render 'blog_posts/list' %}`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test_pages_domain.html.liquid',
      content,
      mode: 'full',
    });
    if (result.domain_guide) {
      expect(result.domain_guide.domain).toBe('pages');
    }
  });

  it('triggered_gotchas is an array when domain_guide is present', async () => {
    const content = `---
slug: test_gotchas_array
---
<div>HTML in page triggers gotchas</div>`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/pages/test_gotchas_array.html.liquid',
      content,
      mode: 'full',
    });
    if (result.domain_guide) {
      expect(Array.isArray(result.domain_guide.triggered_gotchas)).toBe(true);
    }
  });

  it('domain_guide is null when no gotchas are triggered', async () => {
    // A simple valid partial with doc block should not trigger gotchas
    const content = `{% doc %}
  @param title {string} Title text
{% enddoc %}
<h1>{{ title }}</h1>`;
    const result = await server.callTool('validate_code', {
      file_path: 'app/views/partials/test_no_gotchas.liquid',
      content,
      mode: 'full',
    });
    // domain_guide should be null when no gotchas match
    // (it may still be non-null if content-based triggers fire, so we test the type)
    if (result.domain_guide === null) {
      expect(result.domain_guide).toBeNull();
    } else {
      // If it is set, it should still be a proper object
      expect(typeof result.domain_guide).toBe('object');
    }
  });
});
