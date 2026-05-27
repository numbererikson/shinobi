import * as vscode from 'vscode';
import { patchSubtaskStatus, dashboardUrlForProject } from './api';
import { stateStore } from './state';

export function registerCommands(context: vscode.ExtensionContext): void {
  const d = (cmd: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));
  };

  d('shinobi.openDashboard', () => {
    const { activeProject } = stateStore.get();
    const cfg = vscode.workspace.getConfiguration('shinobi').get<string>('dashboardUrl', 'http://127.0.0.1:8765');
    const url = activeProject ? dashboardUrlForProject(activeProject.id) : cfg;
    void vscode.env.openExternal(vscode.Uri.parse(url));
  });

  d('shinobi.refresh', () => {
    void stateStore.refresh();
  });

  d('shinobi.pickProject', async () => {
    const { projects } = stateStore.get();
    if (projects.length === 0) {
      vscode.window.showWarningMessage('Shinobi: no projects found. Is the dashboard running?');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      projects
        .filter((p) => !p.archived_at)
        .map((p) => ({ label: p.title, description: p.workspace ?? undefined, detail: `priority: ${p.priority}`, project: p })),
      { placeHolder: 'Pick the active project to track in this VS Code window' },
    );
    if (!picked) return;
    await vscode.workspace.getConfiguration('shinobi').update('activeProjectId', picked.project.id, vscode.ConfigurationTarget.Global);
    await stateStore.refresh();
  });

  d('shinobi.claimTask', async () => {
    const { snapshot } = stateStore.get();
    if (!snapshot) {
      vscode.window.showWarningMessage('Shinobi: no active project. Run "Shinobi: Pick Active Project" first.');
      return;
    }
    const candidates = snapshot.subtasks.filter((s) => s.status === 'todo');
    if (candidates.length === 0) {
      vscode.window.showInformationMessage('Shinobi: no todo tasks in this project.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      candidates.map((t) => ({ label: t.title, description: t.priority, detail: t.description?.slice(0, 80) ?? undefined, task: t })),
      { placeHolder: 'Pick a task to claim (status → in_progress)' },
    );
    if (!picked) return;
    try {
      await patchSubtaskStatus(picked.task.id, 'in_progress');
      vscode.window.showInformationMessage(`Claimed: ${picked.task.title}`);
      await stateStore.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Claim failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  d('shinobi.completeActiveTask', async () => {
    const { snapshot } = stateStore.get();
    if (!snapshot) return;
    const active = snapshot.subtasks
      .filter((s) => s.status === 'in_progress')
      .sort((a, b) => (b.last_claimed_at ?? '').localeCompare(a.last_claimed_at ?? ''));
    if (active.length === 0) {
      vscode.window.showInformationMessage('Shinobi: no in-progress tasks to complete.');
      return;
    }
    let task = active[0]!;
    if (active.length > 1) {
      const picked = await vscode.window.showQuickPick(
        active.map((t) => ({ label: t.title, task: t })),
        { placeHolder: 'Multiple in-progress tasks — pick one to mark done' },
      );
      if (!picked) return;
      task = picked.task;
    }
    const confirm = await vscode.window.showInformationMessage(
      `Mark "${task.title}" as done?`,
      { modal: true },
      'Complete',
    );
    if (confirm !== 'Complete') return;
    try {
      await patchSubtaskStatus(task.id, 'done');
      vscode.window.showInformationMessage(`Completed: ${task.title}`);
      await stateStore.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Complete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  d('shinobi.logDecision', async () => {
    const { activeProject } = stateStore.get();
    if (!activeProject) {
      vscode.window.showWarningMessage('Shinobi: no active project.');
      return;
    }
    vscode.window.showInformationMessage(
      `Logging decisions from VS Code is not yet wired up — use the Shinobi dashboard at /projects/${activeProject.id}/decisions for now.`,
    );
    void vscode.env.openExternal(
      vscode.Uri.parse(dashboardUrlForProject(activeProject.id) + '/decisions'),
    );
  });
}
