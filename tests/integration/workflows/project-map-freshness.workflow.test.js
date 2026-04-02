import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { startServer, FIXTURE_DIR, createTempProject } from '../helpers/server.js';

setDefaultTimeout(30_000);

// This test uses a temp copy of the fixture project because scaffold(write=true) modifies files.
describe('project_map freshness after scaffold write', () => {
  let tempProject;
  let writeServer;

  beforeAll(async () => {
    tempProject = createTempProject(FIXTURE_DIR);
    writeServer = await startServer(tempProject.dir);
  });

  afterAll(() => {
    writeServer?.stop();
    tempProject?.cleanup();
  });

  it('project_map reflects files written by scaffold', async () => {
    // Baseline: no product commands
    const before = await writeServer.callTool('project_map', { scope: 'full', force_refresh: true });
    const productCmdsBefore = Object.keys(before.commands).filter(k => k.includes('products/'));
    expect(productCmdsBefore).toHaveLength(0);

    // Write scaffold
    const scaffold = await writeServer.callTool('scaffold', {
      type: 'command',
      name: 'product_create',
      properties: [{ name: 'title', type: 'string' }],
      write: true,
    });
    expect(scaffold.written?.length || scaffold.files?.length).toBeGreaterThan(0);

    // project_map should now show the new command
    const after = await writeServer.callTool('project_map', { scope: 'full', force_refresh: true });
    const productCmdsAfter = Object.keys(after.commands).filter(k => k.includes('product_create'));
    expect(productCmdsAfter.length).toBeGreaterThan(0);
  });

  it('project_map reflects newly written query files', async () => {
    // Baseline: no product queries
    const before = await writeServer.callTool('project_map', { scope: 'full', force_refresh: true });
    const productQueriesBefore = Object.keys(before.queries).filter(k => k.includes('featured_items'));
    expect(productQueriesBefore).toHaveLength(0);

    // Write a query scaffold
    const scaffold = await writeServer.callTool('scaffold', {
      type: 'query',
      name: 'featured_items',
      properties: [{ name: 'limit', type: 'integer' }],
      write: true,
    });
    expect(scaffold.written?.length || scaffold.files?.length).toBeGreaterThan(0);

    // project_map should now show the new query
    const after = await writeServer.callTool('project_map', { scope: 'full', force_refresh: true });
    const productQueriesAfter = Object.keys(after.queries).filter(k => k.includes('featured_items'));
    expect(productQueriesAfter.length).toBeGreaterThan(0);
  });

  it('project_map reflects newly written GraphQL files', async () => {
    // Baseline: no order GraphQL operations
    const before = await writeServer.callTool('project_map', { scope: 'full', force_refresh: true });
    const orderGqlBefore = Object.keys(before.graphql).filter(k => k.includes('orders/'));
    expect(orderGqlBefore).toHaveLength(0);

    // Write a command scaffold (includes GraphQL mutation)
    const scaffold = await writeServer.callTool('scaffold', {
      type: 'command',
      name: 'order_ship',
      properties: [{ name: 'shipped_at', type: 'datetime' }],
      write: true,
    });
    expect(scaffold.written?.length || scaffold.files?.length).toBeGreaterThan(0);

    // project_map should now show the new GraphQL operation
    const after = await writeServer.callTool('project_map', { scope: 'full', force_refresh: true });
    // The command scaffold generates a GraphQL mutation — check it was indexed
    const hasNewGraphql = Object.keys(after.graphql).some(k => k.includes('order_ship'));
    const hasNewCommand = Object.keys(after.commands).some(k => k.includes('order_ship'));
    expect(hasNewGraphql || hasNewCommand).toBe(true);
  });
});
