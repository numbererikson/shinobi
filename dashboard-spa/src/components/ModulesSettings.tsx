import { useState } from 'react';
import { Blocks } from 'lucide-react';
import { setModuleEnabled, type ModuleInfo } from '../lib/api';
import { notifyModulesChanged, useModules } from '../lib/modules';

/** Switch modules on/off: Development and every plugin, each on its own. */
export function ModulesSettings() {
  const { modules } = useModules();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(m: ModuleInfo) {
    if (m.enabled && !window.confirm(`Switch off ${m.name}? Its tools disappear from Claude and its pages from the dashboard. Data is kept; switch it on again any time.`)) return;
    setBusy(m.id);
    setError(null);
    try {
      await setModuleEnabled(m.id, !m.enabled);
      notifyModulesChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!modules) return null;
  return (
    <section className="mb-8">
      <h2 className="text-sm uppercase tracking-wider text-text-muted mb-1 flex items-center gap-2">
        <Blocks className="w-3.5 h-3.5" /> Modules
      </h2>
      <p className="text-xs text-text-muted mb-3">
        Each module is independent. A switched-off module&apos;s tools are hidden from Claude (start a new chat to see the change) and its pages leave the sidebar. Nothing is deleted.
      </p>
      {error && <div className="text-danger text-sm mb-2">{error}</div>}
      <ul className="border border-border rounded divide-y divide-border">
        {modules.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm flex items-center gap-2">
                {m.name}
                {m.kind === 'builtin' && <span className="text-[10px] uppercase tracking-wider bg-border-2 rounded px-1.5 py-0.5">built-in</span>}
              </div>
              <div className="text-xs text-text-muted truncate">
                {m.tools} tool{m.tools === 1 ? '' : 's'}
                {m.pages.length > 0 && ` · page: ${m.pages.join(', ')}`}
                {m.kind === 'plugin' && ` · ${m.id}`}
                {m.error && <span className="text-danger"> · {m.error}</span>}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={m.enabled}
              disabled={busy === m.id}
              onClick={() => void toggle(m)}
              className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${m.enabled ? 'bg-accent-2' : 'bg-border-2'} disabled:opacity-50`}
              title={m.enabled ? 'On' : 'Off'}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${m.enabled ? 'left-5' : 'left-0.5'}`} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
