import { Link, useLocation, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { Activity, Archive, Bell, CheckSquare, Mic, Package, Radio, Settings as SettingsIcon } from 'lucide-react';
import { WorkspaceBadge } from './WorkspaceBadge';
import { SyncPanel } from './SyncPanel';
import type { Project } from '../lib/types';

interface SidebarProps {
  projects: Project[];
}

export function Sidebar({ projects }: SidebarProps) {
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const activeId = params.id ? Number(params.id) : null;

  const active = projects.filter((p) => !p.archived_at);
  const archived = projects.filter((p) => p.archived_at);

  const byWorkspace = new Map<string, Project[]>();
  for (const p of active) {
    const ws = p.workspace ?? '(no workspace)';
    if (!byWorkspace.has(ws)) byWorkspace.set(ws, []);
    byWorkspace.get(ws)!.push(p);
  }

  return (
    <aside className="bg-panel-2 border-r border-border w-64 flex-shrink-0 overflow-y-auto scrollbar-thin p-4">
      <Link to="/" className="block text-lg font-bold tracking-wider mb-4 text-text">
        Shinobi 🥷
      </Link>

      <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Workspace</div>
      <ul className="mb-4">
        <li>
          <Link
            to="/sessions"
            className={clsx(
              'block px-2 py-1.5 rounded text-sm transition-colors',
              location.pathname === '/sessions' ? 'bg-border text-text' : 'text-text hover:bg-panel'
            )}
          >
            All sessions
          </Link>
        </li>
        <li>
          <Link
            to="/voice"
            className={clsx(
              'flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
              location.pathname === '/voice' ? 'bg-border text-text' : 'text-text hover:bg-panel'
            )}
          >
            <Mic className="w-3.5 h-3.5" /> Voice capture
          </Link>
        </li>
        <li>
          <Link
            to="/approvals"
            className={clsx(
              'flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
              location.pathname === '/approvals' ? 'bg-border text-text' : 'text-text hover:bg-panel'
            )}
          >
            <CheckSquare className="w-3.5 h-3.5" /> Approvals
          </Link>
        </li>
        <li>
          <Link
            to="/push"
            className={clsx(
              'flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
              location.pathname === '/push' ? 'bg-border text-text' : 'text-text hover:bg-panel'
            )}
          >
            <Bell className="w-3.5 h-3.5" /> Push
          </Link>
        </li>
        <li>
          <Link
            to="/relay"
            className={clsx(
              'flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
              location.pathname === '/relay' ? 'bg-border text-text' : 'text-text hover:bg-panel'
            )}
          >
            <Radio className="w-3.5 h-3.5" /> Relay
          </Link>
        </li>
        <li>
          <Link
            to="/plugins"
            className={clsx(
              'flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
              location.pathname === '/plugins' ? 'bg-border text-text' : 'text-text hover:bg-panel'
            )}
          >
            <Package className="w-3.5 h-3.5" /> Plugins
          </Link>
        </li>
        <li>
          <Link
            to="/telemetry"
            className={clsx(
              'flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
              location.pathname === '/telemetry' ? 'bg-border text-text' : 'text-text hover:bg-panel'
            )}
          >
            <Activity className="w-3.5 h-3.5" /> Telemetry
          </Link>
        </li>
        <li>
          <Link
            to="/settings"
            className={clsx(
              'flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
              location.pathname === '/settings' ? 'bg-border text-text' : 'text-text hover:bg-panel'
            )}
          >
            <SettingsIcon className="w-3.5 h-3.5" /> Settings
          </Link>
        </li>
      </ul>

      <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Projects</div>
      {byWorkspace.size === 0 ? (
        <div className="text-text-muted text-sm italic">(none)</div>
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
                      activeId === p.id ? 'bg-border text-text' : 'text-text hover:bg-panel'
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

      {archived.length > 0 && (
        <>
          <div className="text-[11px] uppercase tracking-wider text-text-muted mt-4 mb-2 flex items-center gap-1.5">
            <Archive className="w-3 h-3" />
            Archived
          </div>
          <ul>
            {archived.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className="block px-2 py-1.5 rounded text-sm text-text-dim hover:bg-panel">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <SyncPanel />
    </aside>
  );
}
