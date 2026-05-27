import { clsx } from 'clsx';
import { workspaceBgClass } from '../lib/format';

export function WorkspaceBadge({ workspace }: { workspace: string | null | undefined }) {
  return (
    <span
      className={clsx(
        'inline-block rounded text-[10px] font-medium lowercase tracking-wider px-1.5 py-0.5',
        workspaceBgClass(workspace),
      )}
    >
      {workspace ?? '(no workspace)'}
    </span>
  );
}
