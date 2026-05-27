import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { stateStore } from './state';
import { createStatusBar } from './statusBar';
import { DeadEndsProvider, DecisionsProvider, TasksProvider } from './trees';

export function activate(context: vscode.ExtensionContext): void {
  createStatusBar(context);
  registerCommands(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('shinobi.tasks', new TasksProvider(context)),
    vscode.window.registerTreeDataProvider('shinobi.decisions', new DecisionsProvider(context)),
    vscode.window.registerTreeDataProvider('shinobi.deadEnds', new DeadEndsProvider(context)),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('shinobi.dashboardUrl') ||
        e.affectsConfiguration('shinobi.token') ||
        e.affectsConfiguration('shinobi.activeProjectId')
      ) {
        void stateStore.refresh();
      }
      if (e.affectsConfiguration('shinobi.pollSeconds')) {
        stateStore.startPolling();
      }
    }),
  );

  void stateStore.refresh();
  stateStore.startPolling();
  context.subscriptions.push(new vscode.Disposable(() => stateStore.stopPolling()));
}

export function deactivate(): void {
  stateStore.stopPolling();
}
