import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface ShinobiConfig {
  sync?: {
    repo_path: string;
    branch: string;
    last_push_at?: string | null;
    last_pull_at?: string | null;
  };
}

export function configDir(): string {
  const override = process.env['SHINOBI_CONFIG_DIR'];
  if (override && override.length > 0) {
    return resolve(override);
  }
  return resolve(homedir(), '.shinobi');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export function loadConfig(): ShinobiConfig {
  if (!existsSync(configPath())) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(configPath(), 'utf-8')) as ShinobiConfig;
  } catch (err) {
    throw new Error(
      `failed to parse ${configPath()}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function saveConfig(config: ShinobiConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function patchConfig(patch: Partial<ShinobiConfig>): ShinobiConfig {
  const current = loadConfig();
  const merged = { ...current, ...patch };
  saveConfig(merged);
  return merged;
}
