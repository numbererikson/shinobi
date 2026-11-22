# Plugins

Shinobi loads plugins from two tiers:

- **User scripts** — drop a `.js` or `.mjs` file in `~/.shinobi/plugins/`.
  Quickest path for one-off integrations.
- **npm packages** — install `@shinobi/plugin-<name>` or `shinobi-plugin-<name>`
  via the dashboard `/plugins` page (or `npm install --prefix ~/.shinobi/plugins-npm <pkg>`).
  Better for shareable, versioned plugins.

Both tiers are auto-discovered on dashboard startup; the loaded list is
visible at `/plugins` under "Loaded at last startup".

## Installing from the dashboard (single-file plugins)

Dashboard → **Plugins** → **Plugins on this server**:

- **Catalog:** one-click install of known plugins (music, AdGuard, Remember, …).
  The catalog is a JSON file at `SHINOBI_PLUGIN_CATALOG_URL`. The default is
  the `catalog.json` in `shinobi-plugin-example`.
- **Install from URL:** paste an https link to a single `.mjs` file.
- **Check for updates / Update / Remove** for each installed file.
- **Restart now** (Docker): Shinobi exits and Docker's restart policy starts it
  again with the new plugins loaded. Outside Docker, restart it yourself.

A plugin runs with full access to the server, so install only what you trust.

## Browsing the marketplace

Open `/plugins` in the dashboard:

1. Type a keyword in the search box (it runs three npm registry queries
   simultaneously: `<query>` with `keywords:shinobi-plugin`, plus pattern
   matches against `@shinobi/plugin-<query>` and `shinobi-plugin-<query>`).
2. Each result row shows package name, version, author, description, and
   an Install / Uninstall button.
3. Install spawns `npm install --prefix ~/.shinobi/plugins-npm <pkg>` as a
   child process — output is captured and the dashboard reports success
   with a toast.
4. **Restart `shinobi dashboard` to pick up the new tools.** Discovery
   only runs at startup.

## Anatomy of a plugin

A plugin's default export receives the registry (tools, pages, scoped state,
schedules, notifications) and a read-only API:

```js
// ~/.shinobi/plugins/shinobi-plugin-echo.mjs
export default function register(registry, api) {
  registry.registerTool({
    name: 'plugin_echo',
    description: 'Echoes its input back.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
      additionalProperties: false,
    },
    handler: (args) => ({ echoed: args.message }),
  });
}
```

Tool names collide-check at startup. The full API (`registry.state`,
`registry.registerPage` blocks, `registry.schedule`, `registry.notify`) is in
[plugin-development.md](plugin-development.md).

## Publishing a plugin

Start from `shinobi-plugin-example`, or create a tiny package whose default
export is `register`:

```json
{
  "name": "@yourname/shinobi-plugin-jira",
  "version": "0.1.0",
  "description": "Sync Jira issues to Shinobi subtasks",
  "type": "module",
  "main": "index.js",
  "keywords": ["shinobi-plugin", "jira"]
}
```

The `keywords` field makes your package discoverable in the marketplace
search. Pick `@shinobi/plugin-*` (requires npm org membership — open an
issue) or `shinobi-plugin-*` (unscoped, available to anyone).

## Install location

- Default: `~/.shinobi/plugins-npm/node_modules/<pkg>`
- Override with `SHINOBI_PLUGINS_NPM_DIR=<path>` in `~/.shinobi/.env`

User scripts default location:

- Default: `~/.shinobi/plugins/`
- Override with `SHINOBI_PLUGINS_DIR=<path>`

## API

The dashboard exposes four endpoints used by the SPA:

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/api/plugins` | — | Lists loaded + installed plugins |
| POST | `/api/plugins/search` | `{ "query": "..." }` | npm registry search (filtered to shinobi plugins) |
| POST | `/api/plugins/install` | `{ "pkg": "@shinobi/plugin-x" }` | Spawns `npm install` |
| DELETE | `/api/plugins/:pkg` | — | Spawns `npm uninstall` |

Install/uninstall return the captured stdout/stderr plus a duration so the
dashboard can render a meaningful toast.

## Safety

- Install/uninstall refuse any package name that does not match the
  `@shinobi/plugin-*` or `shinobi-plugin-*` patterns. This prevents the
  dashboard from being abused as a generic npm runner.
- Loaded plugin tools share the same global registry as built-ins, so a
  malicious plugin can register tools that shadow real ones — only install
  packages you trust.
