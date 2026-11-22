import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { Activity, Bell, CheckSquare, Code, Mic, Package, Radio, Search, Settings as SettingsIcon } from 'lucide-react';
import { WorkspaceBadge } from './WorkspaceBadge';
import { PluginIcon } from './PluginIcon';
import { getRelayStatus, getTelemetrySummary, listPluginPages, type PluginPageSummary } from '../lib/api';
import { useModules } from '../lib/modules';
import { SyncPanel } from './SyncPanel';
import type { Project } from '../lib/types';

interface SidebarProps {
  projects: Project[];
}

const SYSTEM_PATHS = ['/plugins', '/push', '/settings', '/telemetry'];

function NavLink({ to, active, icon, children }: { to: string; active: boolean; icon?: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={clsx(
        'flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
        active ? 'bg-border text-text' : 'text-text hover:bg-panel',
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">{children}</div>;
}

/**
 * Sidebar = one entry per module (Development + each plugin with a page),
 * the selected module's own navigation underneath, and System at the bottom.
 * Switched-off modules (Settings → Modules) do not appear.
 */
export function Sidebar({ projects }: SidebarProps) {
  const location = useLocation();
  const path = location.pathname;
  const params = useParams<{ id?: string }>();
  const activeId = params.id ? Number(params.id) : null;
  const { developmentOn } = useModules();

  const [apps, setApps] = useState<PluginPageSummary[]>([]);
  // Relay and Telemetry are opt-in extras: only list them once configured.
  const [relayOn, setRelayOn] = useState(false);
  const [telemetryOn, setTelemetryOn] = useState(false);
  useEffect(() => {
    getRelayStatus()
      .then((r) => setRelayOn(r.url !== null))
      .catch(() => setRelayOn(false));
    getTelemetrySummary()
      .then((t) => setTelemetryOn(t.enabled || t.total_events > 0))
      .catch(() => setTelemetryOn(false));
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      listPluginPages()
        .then((r) => {
          if (!cancelled) setApps(r.pages);
        })
        .catch(() => {
          /* older server without plugin pages */
        });
    void load();
    window.addEventListener('shinobi:modules-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('shinobi:modules-changed', load);
    };
  }, []);

  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent));
  }, []);
  const modKey = isMac ? '⌘' : 'Ctrl';

  const inApps = path.startsWith('/apps/');
  const inSystem = SYSTEM_PATHS.includes(path);
  const inDevelopment = developmentOn && !inApps && !inSystem;

  // Open projects only: finished ones live under Done on the projects page.
  const open = projects.filter((p) => !p.archived_at && p.status !== 'done');
  const byWorkspace = new Map<string, Project[]>();
  for (const p of open) {
    const ws = p.workspace ?? '(no workspace)';
    if (!byWorkspace.has(ws)) byWorkspace.set(ws, []);
    byWorkspace.get(ws)!.push(p);
  }

  return (
    <aside className="bg-panel-2 border-r border-border w-64 flex-shrink-0 overflow-y-auto scrollbar-thin p-4 flex flex-col">
      <Link to="/" className="block text-lg font-bold tracking-wider mb-4 text-text">
        Shinobi 🥷
      </Link>

      {developmentOn && (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('cmd-palette:open'))}
          className="w-full flex items-center gap-2 px-2 py-1.5 mb-4 rounded text-sm bg-panel border border-border text-text-muted hover:text-text hover:border-accent/60 transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="text-[10px] border border-border rounded px-1 py-0.5">{modKey} K</kbd>
        </button>
      )}

      <SectionTitle>Modules</SectionTitle>
      <ul className="mb-4">
        {developmentOn && (
          <li>
            <NavLink to="/" active={inDevelopment} icon={<Code className="w-3.5 h-3.5" />}>
              Development
            </NavLink>
          </li>
        )}
        {apps.map((a) => (
          <li key={a.id}>
            <NavLink to={`/apps/${a.id}`} active={path === `/apps/${a.id}`} icon={<PluginIcon name={a.icon} className="w-3.5 h-3.5" />}>
              {a.title}
            </NavLink>
          </li>
        ))}
        {!developmentOn && apps.length === 0 && (
          <li className="px-2 py-1.5 text-sm text-text-muted italic">No modules switched on.</li>
        )}
      </ul>

      {inDevelopment && (
        <div className="border-l border-border ml-2 pl-3 mb-4">
          <ul className="mb-4">
            <li>
              <NavLink to="/sessions" active={path === '/sessions'}>All sessions</NavLink>
            </li>
            <li>
              <NavLink to="/voice" active={path === '/voice'} icon={<Mic className="w-3.5 h-3.5" />}>Voice capture</NavLink>
            </li>
            <li>
              <NavLink to="/approvals" active={path === '/approvals'} icon={<CheckSquare className="w-3.5 h-3.5" />}>Approvals</NavLink>
            </li>
            {(relayOn || path === '/relay') && (
              <li>
                <NavLink to="/relay" active={path === '/relay'} icon={<Radio className="w-3.5 h-3.5" />}>Relay</NavLink>
              </li>
            )}
          </ul>

          <SectionTitle>Projects</SectionTitle>
          {byWorkspace.size === 0 ? (
            <div className="text-text-muted text-sm italic">(no open projects)</div>
          ) : (
            [...byWorkspace.entries()].map(([ws, items]) => (
              <div key={ws} className="mb-3">
                <div className="flex items-center gap-1.5 mt-3 mb-1 text-[10px] uppercase tracking-wider text-text-muted">
                  <WorkspaceBadge workspace={ws === '(no workspace)' ? null : ws} />
                  <span>{items.length}</span>
                </div>
                <ul>
                  {items.map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`/projects/${p.id}`}
                        className={clsx(
                          'block px-2 py-1.5 rounded text-sm transition-colors',
                          activeId === p.id ? 'bg-border text-text' : 'text-text hover:bg-panel',
                        )}
                      >
                        {p.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}

      <div className="mt-auto pt-4">
        <SectionTitle>System</SectionTitle>
        <ul className="mb-2">
          <li>
            <NavLink to="/plugins" active={path === '/plugins'} icon={<Package className="w-3.5 h-3.5" />}>Plugins</NavLink>
          </li>
          <li>
            <NavLink to="/push" active={path === '/push'} icon={<Bell className="w-3.5 h-3.5" />}>Push notifications</NavLink>
          </li>
          <li>
            <NavLink to="/settings" active={path === '/settings'} icon={<SettingsIcon className="w-3.5 h-3.5" />}>Settings &amp; modules</NavLink>
          </li>
          {(telemetryOn || path === '/telemetry') && (
            <li>
              <NavLink to="/telemetry" active={path === '/telemetry'} icon={<Activity className="w-3.5 h-3.5" />}>Telemetry</NavLink>
            </li>
          )}
        </ul>
        <SyncPanel />
      </div>
    </aside>
  );
}
