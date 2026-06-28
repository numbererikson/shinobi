-- Generic, scoped persistence for plugins.
--
-- Plugins reach the database read-only through the ShinobiApi facade. Stateful
-- plugins (e.g. the fitness reference plugin) need durable writes. Keeping that
-- state in SQLite rather than a side-file means it inherits the automatic
-- pre-migration backup and `shinobi sync` git replication ("two brain copies")
-- and stays in the shared DB so the stateless /mcp endpoint keeps working
-- behind a tunnel / load balancer.
--
-- One row per (plugin, key). `value` is an opaque JSON blob owned by the plugin.
-- `plugin` is the discovered plugin name; the registry binds each plugin to its
-- own namespace so one plugin cannot read or write another's keys.

CREATE TABLE IF NOT EXISTS plugin_state (
  plugin     TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin, key)
);
