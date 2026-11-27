import { BarChart3, Dumbbell, Home, List, Music, Package, Shield, Swords, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  music: Music,
  shield: Shield,
  dumbbell: Dumbbell,
  swords: Swords,
  home: Home,
  chart: BarChart3,
  list: List,
  package: Package,
};

export function PluginIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Package;
  return <Icon className={className} />;
}
