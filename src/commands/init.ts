import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cwd, execPath, stdout } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir, saveConfig } from '../lib/config.js';
import { getDbPath } from '../lib/db.js';
import { applyPendingMigrations } from '../lib/migrations.js';

const ENV_TEMPLATE = `# Shinobi configuration — values here are loaded by the CLI/server.
# Uncomment and edit to override defaults.

# Override the SQLite path (default: ~/.shinobi/shinobi.db)
# SHINOBI_DB_PATH=/path/to/shinobi.db

# Recall mode: fulltext (default in v0.0.1) or semantic (embeddings, v0.1+)
# SHINOBI_RECALL_MODE=fulltext

# Override the migrations directory (default: <package>/migrations)
# SHINOBI_MIGRATIONS_DIR=/path/to/migrations
`;

function mcpSnippet(): unknown {
  // Use the running Node binary + the absolute path to this package's CLI
  // entrypoint. Avoids the PATH-resolution failures we hit on Windows where
  // the npm-global prefix (e.g. C:\laragon\bin\nodejs\node-v22\) is on the
  // Bash PATH but not in the Windows-native PATH that Claude Code / Cursor
  // use to spawn MCP servers with shell:false.
  const here = fileURLToPath(import.meta.url);
  const cliJs = join(dirname(here), '..', 'cli.js');
  return {
    mcpServers: {
      shinobi: {
        command: execPath,
        args: [cliJs, 'mcp'],
      },
    },
  };
}

export interface InitOptions {
  force?: boolean;
  skipMcpJson?: boolean;
  cwd?: string;
}

export interface InitResult {
  configDir: string;
  dbPath: string;
  envCreated: boolean;
  mcpJsonPath: string | null;
  appliedMigrations: number;
}

export function runInit(options: InitOptions = {}): InitResult {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });

  saveConfig({});

  const envPath = join(dir, '.env');
  let envCreated = false;
  if (!existsSync(envPath) || options.force) {
    writeFileSync(envPath, ENV_TEMPLATE, 'utf-8');
    envCreated = true;
  }

  const result = applyPendingMigrations();

  let mcpJsonPath: string | null = null;
  if (!options.skipMcpJson) {
    const target = join(options.cwd ?? cwd(), '.mcp.json');
    if (existsSync(target) && !options.force) {
      stdout.write(`note: ${target} already exists; pass --force to overwrite\n`);
    } else {
      writeFileSync(target, JSON.stringify(mcpSnippet(), null, 2) + '\n', 'utf-8');
      mcpJsonPath = target;
    }
  }

  return {
    configDir: dir,
    dbPath: getDbPath(),
    envCreated,
    mcpJsonPath,
    appliedMigrations: result.applied.length,
  };
}

export function printInitSummary(result: InitResult): void {
  stdout.write(`\n  shinobi initialized\n`);
  stdout.write(`  config dir:       ${result.configDir}\n`);
  stdout.write(`  database:         ${result.dbPath}\n`);
  stdout.write(`  migrations:       applied ${result.appliedMigrations}\n`);
  stdout.write(`  .env template:    ${result.envCreated ? 'written' : 'preserved'}\n`);
  if (result.mcpJsonPath) {
    stdout.write(`  .mcp.json:        wrote ${result.mcpJsonPath}\n`);
  }
  stdout.write(`\nNext steps:\n`);
  stdout.write(`  1. Restart your MCP client (Claude Code / Cursor / Cline) to pick up the new server.\n`);
  stdout.write(`  2. Optional: edit ${join(result.configDir, '.env')} to override defaults.\n`);
  stdout.write(`  3. Optional: configure cross-machine sync with: shinobi sync init <repo-path> [branch]\n`);
}
