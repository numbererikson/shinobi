import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowUpCircle, CheckCircle2, Download, Link2, RotateCw, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import {
  checkPluginUpdates,
  getPluginCatalog,
  installPluginFromUrl,
  listPluginFiles,
  removePluginFile,
  restartShinobi,
  updatePluginFile,
  type CatalogPlugin,
  type PluginFileInfo,
  type PluginUpdateCheck,
} from '../lib/api';

/**
 * Install, update and remove single-file plugins without a terminal:
 * catalog one-click installs, install from URL, update checks, and a restart
 * button (Docker brings the process back with the new plugins loaded).
 */
export function PluginFiles() {
  const [files, setFiles] = useState<PluginFileInfo[] | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [canRestart, setCanRestart] = useState(false);
  const [catalog, setCatalog] = useState<CatalogPlugin[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Record<string, PluginUpdateCheck>>({});
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listPluginFiles();
      setFiles(r.files);
      setRestartNeeded(r.restart_needed);
      setCanRestart(r.can_restart);
    } catch {
      setFiles(null);
    }
    try {
      const c = await getPluginCatalog();
      setCatalog(c.plugins);
      setCatalogError(c.error ?? null);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(key);
    setMessage(null);
    try {
      const r = await action();
      setMessage(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'failed' });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function checkUpdates() {
    setBusy('updates');
    try {
      const r = await checkPluginUpdates();
      setUpdates(Object.fromEntries(r.updates.map((u) => [u.file, u])));
      const n = r.updates.filter((u) => u.update_available).length;
      setMessage({ ok: true, text: n ? `${n} update${n === 1 ? '' : 's'} available` : 'Everything is up to date' });
    } finally {
      setBusy(null);
    }
  }

  async function restart() {
    setRestarting(true);
    const r = await restartShinobi().catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) {
      setRestarting(false);
      setMessage({ ok: false, text: r.error ?? 'restart failed' });
      return;
    }
    // Wait for the new process to answer, then reload so the sidebar shows new modules.
    const started = Date.now();
    const poll = async () => {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok && Date.now() - started > 1500) {
          window.location.reload();
          return;
        }
      } catch {
        /* still restarting */
      }
      if (Date.now() - started < 60_000) setTimeout(() => void poll(), 1000);
      else setRestarting(false);
    };
    setTimeout(() => void poll(), 1500);
  }

  if (files === null) return null;
  return (
    <section className="bg-panel border border-border rounded-lg p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm text-text flex-1">Plugins on this server</h2>
        <Button size="sm" onClick={() => void checkUpdates()} disabled={busy !== null}>
          <ArrowUpCircle className="w-3.5 h-3.5 mr-1 inline" /> {busy === 'updates' ? 'checking…' : 'Check for updates'}
        </Button>
      </div>

      {restartNeeded && (
        <div className="mb-3 px-3 py-2 rounded border border-warning/50 bg-warning/10 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" />
          <span className="flex-1">Plugins changed. Restart Shinobi to load them.</span>
          {canRestart ? (
            <Button size="sm" variant="primary" onClick={() => void restart()} disabled={restarting}>
              <RotateCw className="w-3.5 h-3.5 mr-1 inline" /> {restarting ? 'restarting…' : 'Restart now'}
            </Button>
          ) : (
            <span className="text-text-muted text-xs">restart the server yourself</span>
          )}
        </div>
      )}

      {message && (
        <div className={`mb-3 text-sm flex items-center gap-2 ${message.ok ? 'text-success' : 'text-danger'}`}>
          {message.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {message.text}
        </div>
      )}

      {files.length === 0 ? (
        <div className="text-text-muted text-sm mb-4">No plugin files yet.</div>
      ) : (
        <ul className="border border-border rounded divide-y divide-border mb-4">
          {files.map((f) => {
            const upd = updates[f.file];
            return (
              <li key={f.file} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm flex items-center gap-2">
                    {f.file}
                    {f.pending_restart ? (
                      <span className="text-[10px] uppercase tracking-wider text-warning">restart to load</span>
                    ) : f.loaded ? (
                      <span className="text-[10px] uppercase tracking-wider text-success">loaded</span>
                    ) : null}
                    {upd?.update_available && <span className="text-[10px] uppercase tracking-wider text-accent">update available</span>}
                  </div>
                  <div className="text-xs text-text-muted truncate">
                    {f.error ? <span className="text-danger">{f.error}</span> : f.url ?? 'copied in by hand (no update source)'}
                    {upd?.error && <span className="text-danger"> · {upd.error}</span>}
                  </div>
                </div>
                {upd?.update_available && (
                  <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void run(f.file, () => updatePluginFile(f.file), `${f.file} updated`)}>
                    Update
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm(`Remove ${f.file}? Its data (plugin state) is kept.`)) void run(f.file, () => removePluginFile(f.file), `${f.file} removed`);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">Catalog</h3>
      {catalogError && <div className="text-xs text-danger mb-2">{catalogError}</div>}
      {catalog && catalog.length > 0 && (
        <ul className="space-y-2 mb-4">
          {catalog.map((p) => (
            <li key={p.id} className="bg-bg border border-border rounded p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text">{p.name}</div>
                <div className="text-xs text-text-muted">{p.description}</div>
              </div>
              {p.installed ? (
                <span className="text-xs text-success self-center">installed</span>
              ) : (
                <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void run(p.id, () => installPluginFromUrl(p.url), `${p.name} installed`)}>
                  <Download className="w-3.5 h-3.5 mr-1 inline" /> {busy === p.id ? 'installing…' : 'Install'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">Install from URL</h3>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const target = url.trim();
          if (!target) return;
          void run('url', () => installPluginFromUrl(target), 'Installed').then(() => setUrl(''));
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/shinobi-plugin-something.mjs"
          className="flex-1 min-w-0 bg-bg border border-border rounded px-3 py-1.5 text-sm text-text"
        />
        <Button type="submit" variant="primary" disabled={busy !== null || !url.trim()}>
          <Link2 className="w-3.5 h-3.5 mr-1 inline" /> Install
        </Button>
      </form>
      <p className="text-xs text-text-muted mt-2">A plugin runs with full access to this server. Only install plugins you trust.</p>
    </section>
  );
}
