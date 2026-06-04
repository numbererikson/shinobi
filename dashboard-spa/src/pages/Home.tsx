import { useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { WorkspaceBadge } from '../components/WorkspaceBadge';
import { PriorityBadge, StatusBadge } from '../components/ui/Badge';
import { timeSince } from '../lib/format';
import type { Project } from '../lib/types';

const WORKSPACE_FILTER_KEY = 'shinobi.home.workspaceFilter';
const ALL_WORKSPACES = '__all__';
const NO_WORKSPACE = '__none__';

interface OutletCtx {
  projects: Project[];
}

function ProgressCell({ done, total }: { done: number; total: number }) {
  if (total === 0) {
    return <span className="text-text-muted text-xs">—</span>;
  }
  const pct = Math.round((done / total) * 100);
  const isDone = done === total;
  const barColor = isDone ? 'bg-emerald-500' : pct >= 50 ? 'bg-accent' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-1.5 bg-border/40 rounded overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${done} of ${total} subtasks done`}
        />
      </div>
      <span className="text-text-muted text-xs tabular-nums whitespace-nowrap">
        {done}/{total} · {pct}%
      </span>
    </div>
  );
}

function ProjectsTable({ rows, dim = false }: { rows: Project[]; dim?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-text-muted text-left">
            <th className="font-medium pb-2 pr-3">Workspace</th>
            <th className="font-medium pb-2 pr-3">Title</th>
            <th className="font-medium pb-2 pr-3">Status</th>
            <th className="font-medium pb-2 pr-3">Priority</th>
            <th className="font-medium pb-2 pr-3">Progress</th>
            <th className="font-medium pb-2 pr-3">Type</th>
            <th className="font-medium pb-2 pr-3">Target path</th>
            <th className="font-medium pb-2 pr-3">Due</th>
            <th className="font-medium pb-2">Created</th>
          </tr>
        </thead>
        <tbody className={dim ? 'opacity-60' : ''}>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-border/40 hover:bg-panel/40">
              <td className="py-2 pr-3"><WorkspaceBadge workspace={p.workspace} /></td>
              <td className="py-2 pr-3">
                <Link to={`/projects/${p.id}`} className="text-text hover:text-accent font-medium">
                  {p.title}
                </Link>
              </td>
              <td className="py-2 pr-3"><StatusBadge status={p.status} /></td>
              <td className="py-2 pr-3"><PriorityBadge priority={p.priority} /></td>
              <td className="py-2 pr-3">
                <ProgressCell done={p.subtasks_done} total={p.subtasks_total} />
              </td>
              <td className="py-2 pr-3 text-text-muted">{p.project_type ?? ''}</td>
              <td className="py-2 pr-3 text-text-muted font-mono text-xs">{p.target_path ?? ''}</td>
              <td className="py-2 pr-3 text-text-muted">{p.due_date ?? ''}</td>
              <td className="py-2 text-text-muted text-xs" title={p.created_at}>{timeSince(p.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Home() {
  const { projects } = useOutletContext<OutletCtx>();
  const [showArchived, setShowArchived] = useState(false);
  const [workspaceFilter, setWorkspaceFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return ALL_WORKSPACES;
    return window.localStorage.getItem(WORKSPACE_FILTER_KEY) ?? ALL_WORKSPACES;
  });

  const workspaces = useMemo(() => {
    const seen = new Set<string>();
    let hasNoWorkspace = false;
    for (const p of projects) {
      if (p.workspace) seen.add(p.workspace);
      else hasNoWorkspace = true;
    }
    const sorted = Array.from(seen).sort((a, b) => a.localeCompare(b));
    return { named: sorted, hasNoWorkspace };
  }, [projects]);

  function applyFilter(rows: Project[]) {
    if (workspaceFilter === ALL_WORKSPACES) return rows;
    if (workspaceFilter === NO_WORKSPACE) return rows.filter((p) => !p.workspace);
    return rows.filter((p) => p.workspace === workspaceFilter);
  }

  const active = applyFilter(projects.filter((p) => !p.archived_at));
  const archived = applyFilter(projects.filter((p) => p.archived_at));

  function onWorkspaceChange(next: string) {
    setWorkspaceFilter(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WORKSPACE_FILTER_KEY, next);
    }
  }

  const showFilter = workspaces.named.length > 1 || (workspaces.named.length >= 1 && workspaces.hasNoWorkspace);

  return (
    <div>
      <header className="flex items-baseline justify-between border-b border-border pb-3 mb-6">
        <h1 className="text-2xl text-text">Projects</h1>
        <span className="text-text-muted text-xs">
          {active.length} active · {archived.length} archived
        </span>
      </header>

      {showFilter && (
        <div className="flex items-center gap-2 mb-4">
          <label htmlFor="workspace-filter" className="text-[11px] uppercase tracking-wider text-text-muted">
            Workspace
          </label>
          <select
            id="workspace-filter"
            value={workspaceFilter}
            onChange={(e) => onWorkspaceChange(e.target.value)}
            className="bg-panel border border-border rounded px-2 py-1 text-sm text-text hover:border-accent/60 focus:outline-none focus:border-accent"
          >
            <option value={ALL_WORKSPACES}>All workspaces</option>
            {workspaces.named.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
            {workspaces.hasNoWorkspace && (
              <option value={NO_WORKSPACE}>(no workspace)</option>
            )}
          </select>
          {workspaceFilter !== ALL_WORKSPACES && (
            <button
              onClick={() => onWorkspaceChange(ALL_WORKSPACES)}
              className="text-xs text-text-muted hover:text-text"
            >
              clear
            </button>
          )}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
          No projects yet. Create one via the <code>create_project</code> MCP tool, then refresh.
        </div>
      ) : active.length === 0 ? (
        <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
          No active projects match this workspace filter.
        </div>
      ) : (
        <ProjectsTable rows={active} />
      )}

      {archived.length > 0 && (
        <section className="mt-8">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-muted hover:text-text mb-3"
          >
            {showArchived ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Archive className="w-3.5 h-3.5" />
            Archived ({archived.length})
          </button>
          {showArchived && <ProjectsTable rows={archived} dim />}
        </section>
      )}
    </div>
  );
}
