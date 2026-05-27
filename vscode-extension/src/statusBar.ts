import * as vscode from 'vscode';
import { stateStore, type ShinobiState } from './state';

export function createStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'shinobi.openDashboard';
  item.show();
  context.subscriptions.push(item);

  const render = (state: ShinobiState): void => {
    if (state.lastError) {
      item.text = '$(warning) Shinobi';
      item.tooltip = `Shinobi error: ${state.lastError}\n\nClick to open the dashboard.`;
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      return;
    }
    item.backgroundColor = undefined;
    if (!state.snapshot) {
      item.text = '$(target) Shinobi';
      item.tooltip = 'Shinobi: no active project yet. Click to open the dashboard.';
      return;
    }
    const active = state.snapshot.subtasks
      .filter((s) => s.status === 'in_progress')
      .sort((a, b) => (b.last_claimed_at ?? '').localeCompare(a.last_claimed_at ?? ''));
    const project = state.snapshot.project;
    if (active.length === 0) {
      item.text = `$(target) ${project.title}`;
      item.tooltip = `No in-progress tasks in ${project.title}.\nClick to open the project in the dashboard.`;
      return;
    }
    const task = active[0];
    item.text = `$(target) ${task!.title.slice(0, 48)}`;
    const more = active.length > 1 ? ` (+${active.length - 1} more)` : '';
    item.tooltip = `${project.title}${project.workspace ? ' / ' + project.workspace : ''}\n${task!.title}${more}\n\nClick to open in the dashboard.`;
  };

  context.subscriptions.push(stateStore.subscribe(render));
  return item;
}
