import { useEffect, useState } from 'react';
import { listModules, type ModuleInfo } from './api';

export const DEVELOPMENT = 'development';
const CHANGED = 'shinobi:modules-changed';

/** Tell every useModules() hook to reload (after a toggle in Settings). */
export function notifyModulesChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Module list from the server. Until it loads, or on an older server without
 * /api/modules, Development counts as on so the classic dashboard still shows.
 */
export function useModules(): { modules: ModuleInfo[] | null; developmentOn: boolean } {
  const [modules, setModules] = useState<ModuleInfo[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      listModules()
        .then((r) => {
          if (!cancelled) setModules(r.modules);
        })
        .catch(() => {
          if (!cancelled) setModules(null);
        });
    void load();
    window.addEventListener(CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGED, load);
    };
  }, []);
  const dev = modules?.find((m) => m.id === DEVELOPMENT);
  return { modules, developmentOn: dev ? dev.enabled : true };
}
