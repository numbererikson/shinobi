import { clsx } from 'clsx';
import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'status-todo' | 'status-in_progress' | 'status-done' | 'priority-urgent' | 'priority-high' | 'priority-medium' | 'priority-low';
  className?: string;
}

const variantClass: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-border-2 text-text',
  'status-todo': 'bg-border text-text',
  'status-in_progress': 'bg-accent-2 text-white',
  'status-done': 'bg-text-dim text-text',
  'priority-urgent': 'bg-danger text-white',
  'priority-high': 'bg-orange text-bg',
  'priority-medium': 'bg-warning text-bg',
  'priority-low': 'bg-text-dim text-text-muted',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-block rounded text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5',
        variantClass[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: 'urgent' | 'high' | 'medium' | 'low' }) {
  return <Badge variant={`priority-${priority}`}>{priority}</Badge>;
}

export function StatusBadge({ status }: { status: 'todo' | 'in_progress' | 'done' }) {
  return <Badge variant={`status-${status}`}>{status}</Badge>;
}
