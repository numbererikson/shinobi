import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

interface TabSpec {
  to: string;
  label: string;
  badge?: ReactNode;
  end?: boolean;
}

interface ProjectTabsProps {
  projectId: number;
  draftPendingCount?: number;
}

export function ProjectTabs({ projectId, draftPendingCount }: ProjectTabsProps) {
  const base = `/projects/${projectId}`;
  const tabs: TabSpec[] = [
    { to: base, label: 'Kanban', end: true },
    { to: `${base}/subtasks`, label: 'Subtasks' },
    { to: `${base}/decisions`, label: 'Decisions' },
    {
      to: `${base}/decision-drafts`,
      label: 'Drafts',
      badge:
        draftPendingCount && draftPendingCount > 0 ? (
          <span className="ml-1 inline-block bg-warning text-bg text-[9px] font-bold px-1.5 py-0.5 rounded-full">
            {draftPendingCount}
          </span>
        ) : null,
    },
    { to: `${base}/dead-ends`, label: 'Dead Ends' },
    { to: `${base}/notes`, label: 'Notes' },
    { to: `${base}/plans`, label: 'Plans' },
    { to: `${base}/context`, label: 'Context' },
    { to: `${base}/sessions`, label: 'Sessions' },
    { to: `${base}/timeline`, label: 'Timeline' },
    { to: `${base}/analytics`, label: 'Analytics' },
  ];

  return (
    <nav className="flex gap-1 mb-4 border-b border-border overflow-x-auto scrollbar-thin">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            clsx(
              'px-3.5 py-2 text-sm -mb-px border-b-2 whitespace-nowrap transition-colors flex items-center',
              isActive
                ? 'text-text border-accent'
                : 'text-text-muted border-transparent hover:text-text hover:border-border-2',
            )
          }
        >
          {t.label}
          {t.badge}
        </NavLink>
      ))}
    </nav>
  );
}
