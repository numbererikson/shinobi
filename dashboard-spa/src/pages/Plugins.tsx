import { useCallback, useEffect, useState } from 'react';
import { Package, Search, Download, Trash2, AlertCircle, CheckCircle2, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import {
  installPlugin,
  listPlugins,
  searchPluginMarketplace,
  uninstallPlugin,
  type MarketplaceHit,
  type PluginsResponse,
} from '../lib/api';

export function Plugins() {
  const [state, setState] = useState<PluginsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<MarketplaceHit[] | null>(null);
  const [busyPkg, setBusyPkg] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listPlugins();
      setState(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runSearch() {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      const r = await searchPluginMarketplace(query.trim());
      setResults(r.results);
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSearching(false);
    }
  }

  async function install(pkg: string) {
    setBusyPkg(pkg);
    try {
      const r = await installPlugin(pkg);
      setToast({
        kind: r.ok ? 'ok' : 'err',
        text: r.ok ? `installed ${pkg} — restart dashboard to load tools` : (r.stderr || 'install failed').slice(0, 200),
      });
      await refresh();
      if (results) await runSearch();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyPkg(null);
    }
  }

  async function uninstall(pkg: string) {
    setBusyPkg(pkg);
    try {
      const r = await uninstallPlugin(pkg);
      setToast({
        kind: r.ok ? 'ok' : 'err',
        text: r.ok ? `uninstalled ${pkg} — restart dashboard to drop tools` : (r.stderr || 'uninstall failed').slice(0, 200),
      });
      await refresh();
      if (results) await runSearch();
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyPkg(null);
    }
  }

  if (err) return <div className="text-danger">Error: {err}</div>;
  if (!state) return <div className="text-text-muted">loading plugins...</div>;

  return (
    <div className="max-w-4xl">
      <header className="border-b border-border pb-3 mb-6">
        <h1 className="text-2xl text-text flex items-center gap-2">
          <Package className="w-6 h-6 text-accent" /> Plugins
        </h1>
        <p className="text-text-muted text-xs mt-1">
          Extend Shinobi with community-maintained packages from npm. Install location: <code>{state.install_prefix}</code>
        </p>
      </header>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded text-sm flex items-center gap-2 ${toast.kind === 'ok' ? 'bg-success/20 text-success border border-success/40' : 'bg-danger/20 text-danger border border-danger/40'}`}>
          {toast.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.text}
        </div>
      )}

      <section className="bg-panel border border-border rounded-lg p-5 mb-6">
        <h2 className="text-sm text-text mb-3">Search npm registry</h2>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            className="flex-1 bg-bg border border-border rounded px-3 py-1.5 text-sm text-text"
            placeholder="e.g. github, jira, time-tracking (looks under @shinobi/plugin-* and shinobi-plugin-*)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
          />
          <Button variant="primary" onClick={() => void runSearch()} disabled={searching}>
            <Search className="w-4 h-4 mr-1" /> Search
          </Button>
        </div>

        {results !== null && (
          results.length === 0 ? (
            <div className="text-text-muted text-sm">no matching plugins published yet</div>
          ) : (
            <div className="space-y-2">
              {results.map((r) => (
                <div key={r.name} className="bg-bg border border-border rounded p-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <div className="text-text font-medium">{r.name}</div>
                      <div className="text-text-muted text-xs">v{r.version}{r.author ? ' · ' + r.author : ''}</div>
                      {r.links.npm && (
                        <a href={r.links.npm} target="_blank" rel="noreferrer" className="text-accent text-xs hover:underline">
                          npm <ExternalLink className="w-3 h-3 inline" />
                        </a>
                      )}
                    </div>
                    <div className="text-text-muted text-xs mt-1">{r.description || '(no description)'}</div>
                  </div>
                  {r.installed ? (
                    <Button variant="default" onClick={() => void uninstall(r.name)} disabled={busyPkg === r.name}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Uninstall
                    </Button>
                  ) : (
                    <Button variant="primary" onClick={() => void install(r.name)} disabled={busyPkg === r.name}>
                      <Download className="w-3.5 h-3.5 mr-1" /> {busyPkg === r.name ? 'installing…' : 'Install'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </section>

      <section className="mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm text-text">Installed ({state.installed.length})</h2>
          <button onClick={() => void refresh()} className="text-[11px] uppercase tracking-wider text-accent hover:underline">
            <RefreshCw className="w-3 h-3 inline mr-0.5" /> refresh
          </button>
        </div>
        {state.installed.length === 0 ? (
          <div className="text-text-muted text-sm">(no plugins installed yet)</div>
        ) : (
          <div className="space-y-2">
            {state.installed.map((p) => (
              <div key={p.name} className="bg-panel border border-border rounded p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-text font-medium">{p.name} <span className="text-text-muted text-xs">v{p.version}</span></div>
                  <div className="text-text-muted text-xs">{p.description}</div>
                </div>
                <Button variant="ghost" onClick={() => void uninstall(p.name)} disabled={busyPkg === p.name} title="uninstall">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm text-text mb-3">Loaded at last startup ({state.loaded.length})</h2>
        {state.loaded.length === 0 ? (
          <div className="text-text-muted text-sm">(none yet — install + restart dashboard)</div>
        ) : (
          <div className="space-y-2">
            {state.loaded.map((p) => (
              <div key={p.name} className="bg-panel border border-border rounded p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-text font-medium">{p.name}</div>
                  <Badge className={p.source === 'user' ? 'bg-warning/30 text-warning' : 'bg-accent/30 text-accent'}>{p.source}</Badge>
                </div>
                <div className="text-text-muted text-xs font-mono break-all mt-1">{p.module_path}</div>
                {p.tools_registered.length > 0 && (
                  <div className="text-text-dim text-[11px] mt-2">tools: {p.tools_registered.join(', ')}</div>
                )}
                {p.error && (
                  <div className="text-danger text-xs mt-2">error: {p.error}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
