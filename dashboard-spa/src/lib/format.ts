export function timeSince(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('T') || iso.includes('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return iso;
  const seconds = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  const months = days / 30;
  if (months < 12) return `${Math.floor(months)}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function workspaceSlug(workspace: string | null | undefined): string {
  if (!workspace) return 'none';
  return workspace.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function workspaceBgClass(workspace: string | null | undefined): string {
  const slug = workspaceSlug(workspace);
  switch (slug) {
    case 'shinobi': return 'bg-ws-shinobi text-white';
    case 'shinobiapps': return 'bg-ws-shinobiapps text-bg';
    case 'sitesnap': return 'bg-ws-sitesnap text-bg';
    default: return 'bg-border-2 text-text-muted italic';
  }
}
