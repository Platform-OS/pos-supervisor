export const serverStatusTool = {
  name: 'server_status',
  description: 'Check pos-supervisor server status: LSP readiness, loaded indexes, pos-cli availability. Use this to diagnose issues when other tools return incomplete results.',
  inputSchema: {},

  createHandler(ctx) {
    return async () => {
      return {
        server: 'pos-supervisor',
        version: ctx.version,
        project_dir: ctx.directory,
        pos_cli: {
          found: ctx.posCliFound ?? false,
          check_cmd: ctx.checkCmd,
        },
        lsp: {
          initialized: ctx.lsp?.initialized ?? false,
        },
        indexes: {
          schema: ctx.schemaIndex?._loaded ?? false,
          objects: ctx.objectsIndex?._loaded ?? false,
          filters: ctx.filtersIndex?._loaded ?? false,
          tags: ctx.tagsIndex?._loaded ?? false,
        },
        data_dir: ctx.dataDir ?? null,
      };
    };
  },
};
