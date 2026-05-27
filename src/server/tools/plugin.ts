import { listLoadedPlugins } from '../../services/plugins/state.js';
import type { ShinobiTool } from './types.js';

export const pluginTools: ShinobiTool[] = [
  {
    name: 'plugin_hello',
    description: 'List discovered plugins and their registered tools. Use this to verify the plugin system loaded correctly. Plugins are loaded from ~/.shinobi/plugins/*.{js,mjs} (user tier) and node_modules/@shinobi/plugin-* (npm tier).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: () => {
      const plugins = listLoadedPlugins();
      return {
        plugins,
        count: plugins.length,
        tool_count: plugins.reduce((sum, p) => sum + p.tools_registered.length, 0),
        tiers: {
          user: '~/.shinobi/plugins/*.{js,mjs}',
          npm: 'node_modules/@shinobi/plugin-*',
        },
        ok: plugins.every((p) => p.error === null),
      };
    },
  },
];
