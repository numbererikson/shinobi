import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { Companion } from './Companion';
import { listProjects } from '../lib/api';
import type { Project } from '../lib/types';

export function Layout() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    function onOpenEvent() { setPaletteOpen(true); }
    window.addEventListener('keydown', onKey);
    window.addEventListener('cmd-palette:open', onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('cmd-palette:open', onOpenEvent);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listProjects({ sort: 'active', include_archived: true })
      .then((p) => {
        if (!cancelled) setProjects(p);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center text-danger">
        <div>
          <h1 className="text-xl mb-2">Failed to load projects</h1>
          <pre className="text-sm">{err}</pre>
        </div>
      </div>
    );
  }

  if (!projects) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-muted">
        loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Desktop persistent sidebar */}
      <div className="hidden md:block">
        <Sidebar projects={projects} />
      </div>

      {/* Mobile slide-in drawer */}
      {drawerOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="md:hidden fixed inset-y-0 left-0 z-50 shadow-2xl">
            <Sidebar projects={projects} />
          </div>
        </>
      )}

      <main className="flex-1 overflow-y-auto min-w-0">
        {/* Mobile top bar with hamburger */}
        <div className="md:hidden sticky top-0 z-30 bg-bg/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            className="text-text hover:text-accent"
            aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          >
            {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <span className="text-text font-semibold tracking-wider">Shinobi 🥷</span>
        </div>
        <div className="p-4 md:p-8">
          <Outlet context={{ projects }} />
        </div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Companion />
    </div>
  );
}
