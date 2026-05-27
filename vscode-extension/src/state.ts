import * as vscode from 'vscode';
import * as api from './api';

export interface ShinobiState {
  projects: api.Project[];
  activeProject: api.Project | null;
  snapshot: api.ProjectSnapshot | null;
  lastFetchedAt: number;
  lastError: string | null;
}

type Listener = (state: ShinobiState) => void;

const EMPTY_STATE: ShinobiState = {
  projects: [],
  activeProject: null,
  snapshot: null,
  lastFetchedAt: 0,
  lastError: null,
};

class StateStore {
  private state: ShinobiState = { ...EMPTY_STATE };
  private listeners: Set<Listener> = new Set();
  private pollTimer: NodeJS.Timeout | null = null;

  get(): ShinobiState {
    return this.state;
  }

  subscribe(listener: Listener): vscode.Disposable {
    this.listeners.add(listener);
    listener(this.state);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }

  async refresh(): Promise<void> {
    try {
      const projects = await api.listProjects();
      const activeId = vscode.workspace.getConfiguration('shinobi').get<number>('activeProjectId', 0);
      let activeProject = projects.find((p) => p.id === activeId) ?? null;
      if (!activeProject && projects.length > 0) {
        activeProject = projects.find((p) => !p.archived_at) ?? projects[0] ?? null;
      }
      let snapshot: api.ProjectSnapshot | null = null;
      if (activeProject) {
        snapshot = await api.getSnapshot(activeProject.id);
      }
      this.state = {
        projects,
        activeProject,
        snapshot,
        lastFetchedAt: Date.now(),
        lastError: null,
      };
    } catch (err) {
      this.state = {
        ...this.state,
        lastError: err instanceof Error ? err.message : String(err),
        lastFetchedAt: Date.now(),
      };
    }
    this.emit();
  }

  startPolling(): void {
    this.stopPolling();
    const seconds = vscode.workspace.getConfiguration('shinobi').get<number>('pollSeconds', 5);
    this.pollTimer = setInterval(() => void this.refresh(), Math.max(2, seconds) * 1000);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export const stateStore = new StateStore();
