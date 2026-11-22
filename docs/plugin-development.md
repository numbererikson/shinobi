# Writing a Shinobi plugin

Plugins extend the MCP tool surface without modifying the Shinobi source. They run inside the same Node process. They read the database through the read-only `ShinobiApi` facade, and persist their own state through the writable, per-plugin `registry.state` store.

## Quick start

Create a file in `~/.shinobi/plugins/` (or wherever `SHINOBI_PLUGINS_DIR` points):

```js
// ~/.shinobi/plugins/hello-world.js
export default function register(registry, api) {
  registry.registerTool({
    name: 'plugin_hello_world',
    description: 'Echo a friendly message',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: (args) => ({ greeting: `Hello, ${args.name}!` }),
  });
}
```

Restart your MCP client and `mcp__shinobi__plugin_hello_world` is available.

## Naming

Plugin tools MUST match `/^plugin_[a-z][a-z0-9_]*$/`. Names without the `plugin_` prefix are rejected at registration time.

## The `api` facade

The second argument to `register` and to every handler call (when you pass it through) is a read-only facade. Available methods:

```ts
listProjects(opts?: { includeArchived?: boolean; status?: Status }): Project[]
getProject(id: number): Project | null
projectsMatchingTargetPath(filePath: string): Project[]

listSubtasks(opts?: { projectId?: number; status?: Status; sessionId?: string }): Subtask[]
getSubtask(id: number): Subtask | null
searchSubtasks(query: string, projectId?: number, limit?: number): Subtask[]

searchDecisions(query: string, projectId?: number, limit?: number): Decision[]
listDecisions(opts?: ListDecisionsOptions): Decision[]

checkDeadEnds(input: { approach: string; files?: string[]; projectId?: number; limit?: number }): DeadEnd[]
listDeadEnds(opts?: { projectId?: number; limit?: number }): DeadEnd[]

searchNotes(query: string, projectId?: number, limit?: number): Note[]
listNotes(opts?: { projectId?: number; limit?: number }): Note[]

getContext(projectId: number): Context | null
listActivity(opts?: ListActivityOptions): ActivityRow[]

getProjectSnapshot(projectId: number): {
  project: Project | null;
  subtasks: Subtask[];
  recent_decisions: Decision[];
  recent_dead_ends: DeadEnd[];
  context: Context | null;
}
```

The `api` facade is read-only over Shinobi's own entities (projects, tasks, decisions, …). To change those, return a description of what to write and have the LLM call a built-in tool. To persist your **own** plugin state, use `registry.state` (below).

## Persistent plugin state (`registry.state`)

The `registry` passed to `register` carries a durable key/value store scoped to
your plugin's name — one plugin can never read or write another's keys. State is
JSON-serializable and lives in Shinobi's SQLite database, so it inherits the
automatic pre-migration backup and `shinobi sync` replication and works behind
the stateless remote `/mcp` endpoint.

```ts
interface PluginStateStore {
  get<T>(key: string): T | null;            // null if absent or unparseable
  set(key: string, value: unknown): void;   // JSON-serialized
  delete(key: string): void;
  update<T>(key: string, mutator: (current: T | null) => T): T; // atomic
}
```

Prefer `update` for read-modify-write so concurrent async handlers cannot
clobber each other — it runs the mutator inside a single SQLite transaction:

```js
export default function register(registry) {
  registry.registerTool({
    name: 'plugin_counter_bump',
    description: 'Increment a persistent counter',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const next = registry.state.update('count', (cur) => (cur ?? 0) + 1);
      return { count: next };
    },
  });
}
```

A corrupt or absent value reads back as `null`, so a damaged blob degrades to
"no state" instead of crashing the host. A full reference plugin built on this
store lives in the `shinobi-plugin-example` repository.

### Testing a plugin in-process

`createInProcessRegistry(pluginName, api?, { send? })` (from
`src/services/plugins/registry.ts`) gives you a registry that collects tools,
pages and schedules locally and exposes real, scoped `registry.state`, plus
helpers — handy for unit tests and smoke harnesses without touching the global
MCP tool registry:

- `call(name, args)` runs a tool.
- `runSchedule(id)` fires a schedule now.
- `send` replaces web push delivery, so a test can capture what `notify` sent;
  `runPushAction(token)` then presses one of its buttons by token.

## Dashboard pages (`registry.registerPage`)

A plugin can add a page to the dashboard. It shows up in the sidebar under
**Apps**, at `/apps/<id>`. The page is **data, not code**: `render()` returns a
list of blocks and the dashboard draws them. Plugins never ship UI code, so a
page cannot run script in the dashboard, and a single-file plugin stays a
single file.

```js
export default function register(registry) {
  registry.registerTool({ name: 'plugin_music_control', /* … */ });

  if (typeof registry.registerPage === 'function') {   // hosts older than 0.4.0 lack it
    registry.registerPage({
      id: 'music',            // /apps/music — lowercase, digits, dashes; unique across plugins
      title: 'Music',
      icon: 'music',          // music | shield | dumbbell | home | chart | list | package
      order: 10,              // sidebar position (lower first), optional
      render: async () => ({
        refreshSeconds: 5,    // optional auto-refresh while the page is open (min 2)
        blocks: [
          { type: 'stats', items: [{ label: 'Now playing', value: 'Kashmir', hint: 'Led Zeppelin' }] },
          { type: 'actions', buttons: [
            { label: 'Next', tool: 'plugin_music_control', args: { action: 'next' }, variant: 'primary' },
          ] },
        ],
      }),
    });
  }
}
```

`render` may return the blocks array directly, or `{ blocks, refreshSeconds }`.

| Block | Fields |
| --- | --- |
| `heading` | `text` |
| `text` | `text`, `tone?` |
| `stats` | `items: [{ label, value, hint?, tone? }]` |
| `table` | `columns: string[]`, `rows: string[][]`, `empty?` |
| `list` | `items: [{ title, subtitle?, badge?, tone? }]`, `empty?` |
| `progress` | `label`, `value`, `max`, `hint?` |
| `actions` | `buttons: [{ label, tool, args?, confirm?, variant? }]` |
| `input` | `tool`, `arg`, `button`, `label?`, `placeholder?`, `args?`, `maxLength?` (≤ 2000, default 500): a text field whose submit calls `tool` with `{ ...args, [arg]: <typed text> }` |
| `divider` | — |

`tone` is one of `default`, `muted`, `ok`, `warn`, `error`. Button `variant`
is `default`, `primary` or `danger`. A button with `confirm` asks first.

**Rules the host enforces:**
- Everything is plain text, with lengths and counts capped. Unknown block types
  and malformed fields are dropped.
- A button may only call a tool registered by **the same plugin**. Buttons
  aimed at core tools or at other plugins' tools are removed. The action
  endpoint refuses them too.
- `render` and button tools time out after 10 s. A `render` that throws shows
  its error message on the page instead of breaking the dashboard.
- After a button press the page is re-rendered, so the new state shows at once.

Pages load in the same process that loads plugins: the Docker image, or
`shinobi dashboard` with `SHINOBI_MCP_HTTP=on`. The endpoints are
`GET /api/plugin-pages`, `GET /api/plugin-pages/:id` and
`POST /api/plugin-pages/:id/action` (`{ tool, args }`), all behind dashboard
auth. The in-process test registry (`createInProcessRegistry`) collects pages
in a `pages` map, so a plugin's `render` can be unit-tested.

## Scheduled jobs (`registry.schedule`)

A plugin can run code on a cron schedule — a morning summary, a reminder check
every minute, a nightly sync. Nothing needs to be asked of Claude for it to
happen.

```js
export default function register(registry) {
  if (typeof registry.schedule === 'function') {   // hosts older than 0.7.0 lack it
    registry.schedule({
      id: 'morning-brief',       // unique within the plugin: lowercase, digits, - and _
      cron: '0 8 * * 1-5',       // minute hour day-of-month month day-of-week
      timezone: 'Europe/Zagreb', // optional IANA zone; defaults to the host's
      run: async (api) => {
        const open = api.listSubtasks({ status: 'todo' }).length;
        await registry.notify({ title: 'Good morning', body: `${open} open tasks` });
      },
    });
  }
}
```

The cron fields accept `*`, numbers, ranges `a-b`, steps `*/n` and `a-b/n`, and
comma lists. Day-of-week is 0–7, where 0 and 7 are both Sunday. When both
day-of-month and day-of-week are restricted, either one matching is enough.

**Rules the host enforces:**
- Schedules tick only in the long-lived process: the Docker image, or
  `shinobi dashboard` with `SHINOBI_MCP_HTTP=on`. A stdio MCP session loads the
  plugin and registers the schedule, but never runs it, so opening ten
  sessions does not run a job ten times.
- Each minute slot runs **at most once**: it is claimed in the database before
  `run` starts, which also holds across a restart within the same minute.
- Missed slots are not replayed. If the host was down at 08:00, the 08:00 run
  is skipped. A job that must not miss anything (e.g. reminders) should tick
  often and compare stored due times with "now" rather than rely on one slot.
- `run` times out after 50 s. A throwing `run` is logged and recorded; it never
  stops other schedules.
- A Docker container runs in UTC unless you set `TZ`. Pass `timezone` so
  `0 8 * * *` means 08:00 where you are.

## Push notifications (`registry.notify`)

A plugin can push a notification to every device subscribed under **Push**.
Up to two buttons can call the plugin's own tools when pressed — no need to
open the dashboard.

```js
const result = await registry.notify({
  title: 'Call the bank',
  body: 'Reminder from 09:00',
  url: '/apps/reminders',          // optional: opened when the notification is tapped
  tag: 'reminder-17',              // optional: same tag replaces the previous one
  actions: [                       // optional, at most 2
    { label: 'Done', tool: 'plugin_reminders_done', args: { id: 17 } },
    { label: 'Snooze 1h', tool: 'plugin_reminders_snooze', args: { id: 17, minutes: 60 } },
  ],
});
// result: { total, succeeded, failed, pruned_endpoints, error }
```

**Rules the host enforces:**
- A button may only call a tool registered by **the same plugin**; anything
  else throws at `notify` time.
- Each button carries an unguessable one-time token. The device sends back
  only the token (`POST /api/plugin-actions/:token`, behind dashboard auth),
  and the server runs the mapped tool with its stored `args`.
- Pressing one button retires every button of that notification, so "Done"
  and "Snooze" on one reminder can never both run. Buttons expire after 7 days.
- `title` is capped at 120 characters, `body` at 1000, button labels at 40.
  `url` must be a same-origin path starting with `/`.
- Delivery failures never throw; they are reported in `result`. Invalid input
  throws.
- `notify` works from any process — a tool handler in a stdio session or a
  schedule in the dashboard.

## Modules

Every plugin is a module that the owner can switch off under **Settings →
Modules**. When it is off, the plugin's tools are left out of `tools/list` and
calls to them fail with a clear message, and its pages leave the sidebar. Its
schedules stop firing, `notify` sends nothing (`result.error` is
`'module disabled'`), and buttons on notifications it already sent are refused.
The plugin is still loaded and its `registry.state` is kept. A plugin needs no
code for this.

## Async handlers

Handlers may be async. Throw on invalid input; the MCP server catches and returns `isError: true` to the client.

```js
export default function register(registry, api) {
  registry.registerTool({
    name: 'plugin_fetch_stuff',
    description: 'Fetch from an external API',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    handler: async (args) => {
      const r = await fetch(args.url);
      if (!r.ok) throw new Error(`http ${r.status}`);
      return await r.json();
    },
  });
}
```

## Npm-tier plugins

Plugins can be published as npm packages with the name pattern `@shinobi/plugin-*`. Shinobi scans `node_modules/@shinobi/` in the CWD at start. Your `package.json` should set `"main"` (or `"exports.\".\".import"`) to a module that exports `default` matching the same register signature.

## Verifying a plugin loaded

Open **Dashboard → Plugins**. Every discovered plugin is listed with its tier, registered tools and any load error; **Settings → Modules** switches each plugin on or off.

## Failure modes

- **No default export** — the plugin file loads but contributes nothing; Dashboard → Plugins shows `error: "no default/register export"`.
- **Throwing register** — the plugin's tools are not registered; the throw is captured to `error`.
- **Name collision** — registration throws synchronously; shown in Dashboard → Plugins.
- **Bad inputSchema** — accepted at registration; only fails at call time when MCP validates.

Plugins do not impede built-in tool availability — a broken plugin leaves the built-ins intact.
