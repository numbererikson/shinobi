import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { WorkspaceBadge } from '../components/WorkspaceBadge';
import { PriorityBadge, StatusBadge } from '../components/ui/Badge';
import { timeSince } from '../lib/format';
import type { Project } from '../lib/types';

interface OutletCtx {
  projects: Project[];
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
  const active = projects.filter((p) => !p.archived_at);
  const archived = projects.filter((p) => p.archived_at);
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div>
      <header className="flex items-baseline justify-between border-b border-border pb-3 mb-6">
        <h1 className="text-2xl text-text">Projects</h1>
        <span className="text-text-muted text-xs">
          {active.length} active · {archived.length} archived
        </span>
      </header>

      {projects.length === 0 ? (
        <div className="bg-panel border border-dashed border-border rounded p-6 text-center text-text-muted">
          No projects yet. Create one via the <code>create_project</code> MCP tool, then refresh.
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
