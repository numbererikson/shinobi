export interface PluginInfo {
  name: string;
  source: 'user' | 'npm';
  module_path: string;
  tools_registered: string[];
  error: string | null;
}

const loadedPlugins: PluginInfo[] = [];

export function recordPlugin(info: PluginInfo): void {
  loadedPlugins.push(info);
}

export function findPlugin(name: string): PluginInfo | undefined {
  return loadedPlugins.find((p) => p.name === name);
}

export function listLoadedPlugins(): PluginInfo[] {
  return loadedPlugins.slice();
}

export function resetPluginState(): void {
  loadedPlugins.length = 0;
}
