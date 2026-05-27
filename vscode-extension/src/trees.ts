import * as vscode from 'vscode';
import { stateStore } from './state';
import { dashboardUrlForSubtask, type DeadEnd, type Decision, type Subtask } from './api';

type ChangeEmitter<T> = vscode.EventEmitter<T | undefined | null | void>;

abstract class BaseProvider<TItem extends vscode.TreeItem> implements vscode.TreeDataProvider<TItem> {
  private readonly onChange: ChangeEmitter<TItem> = new vscode.EventEmitter();
  readonly onDidChangeTreeData = this.onChange.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(stateStore.subscribe(() => this.onChange.fire()));
  }

  getTreeItem(element: TItem): TItem {
    return element;
  }

  abstract getChildren(): Promise<TItem[]>;
}

class TaskItem extends vscode.TreeItem {
  constructor(public readonly task: Subtask, projectId: number) {
    const status = task.status;
    const icon =
      status === 'in_progress'
        ? new vscode.ThemeIcon('debug-start', new vscode.ThemeColor('charts.green'))
        : status === 'done'
        ? new vscode.ThemeIcon('check')
        : new vscode.ThemeIcon('circle-outline');
    super(task.title, vscode.TreeItemCollapsibleState.None);
    this.id = `task-${task.id}`;
    this.iconPath = icon;
    this.description = task.priority !== 'medium' ? task.priority : undefined;
    this.tooltip = task.description ?? task.title;
    this.command = {
      command: 'vscode.open',
      title: 'Open in dashboard',
      arguments: [vscode.Uri.parse(dashboardUrlForSubtask(projectId, task.id))],
    };
    this.contextValue = `task-${status}`;
  }
}

class DecisionItem extends vscode.TreeItem {
  constructor(public readonly decision: Decision) {
    super(decision.title, vscode.TreeItemCollapsibleState.None);
    this.id = `decision-${decision.id}`;
    this.description = decision.status;
    this.tooltip = decision.body.slice(0, 400);
    this.iconPath = new vscode.ThemeIcon('lightbulb');
  }
}

class DeadEndItem extends vscode.TreeItem {
  constructor(public readonly deadEnd: DeadEnd) {
    super(deadEnd.title, vscode.TreeItemCollapsibleState.None);
    this.id = `deadend-${deadEnd.id}`;
    this.tooltip = `Tried: ${deadEnd.what_was_tried}\n\nWhy it failed: ${deadEnd.why_it_failed}`;
    this.iconPath = new vscode.ThemeIcon('error');
  }
}

class StatusItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

export class TasksProvider extends BaseProvider<vscode.TreeItem> {
  async getChildren(): Promise<vscode.TreeItem[]> {
    const { snapshot, lastError } = stateStore.get();
    if (lastError) return [new StatusItem(`Error: ${lastError}`)];
    if (!snapshot) return [new StatusItem('No active project. Run "Shinobi: Pick Active Project".')];
    const grouped: Record<string, Subtask[]> = { in_progress: [], todo: [], done: [] };
    for (const s of snapshot.subtasks) (grouped[s.status] ??= []).push(s);
    const items: vscode.TreeItem[] = [];
    for (const status of ['in_progress', 'todo', 'done'] as const) {
      const tasks = grouped[status] ?? [];
      if (tasks.length === 0) continue;
      const header = new vscode.TreeItem(`${status.toUpperCase()} (${tasks.length})`, vscode.TreeItemCollapsibleState.None);
      header.contextValue = `header-${status}`;
      items.push(header);
      for (const t of tasks.slice(0, 30)) items.push(new TaskItem(t, snapshot.project.id));
    }
    return items;
  }
}

export class DecisionsProvider extends BaseProvider<vscode.TreeItem> {
  async getChildren(): Promise<vscode.TreeItem[]> {
    const { snapshot, lastError } = stateStore.get();
    if (lastError) return [new StatusItem(`Error: ${lastError}`)];
    if (!snapshot) return [new StatusItem('No active project.')];
    const open = snapshot.decisions.filter((d) => d.status === 'open' || d.status === 'fix_now' || d.status === 'fix_later');
    const recent = open.slice(0, 20);
    if (recent.length === 0) return [new StatusItem('(no open decisions)')];
    return recent.map((d) => new DecisionItem(d));
  }
}

export class DeadEndsProvider extends BaseProvider<vscode.TreeItem> {
  async getChildren(): Promise<vscode.TreeItem[]> {
    const { snapshot, lastError } = stateStore.get();
    if (lastError) return [new StatusItem(`Error: ${lastError}`)];
    if (!snapshot) return [new StatusItem('No active project.')];
    if (snapshot.dead_ends.length === 0) return [new StatusItem('(no dead ends)')];
    return snapshot.dead_ends.slice(0, 20).map((d) => new DeadEndItem(d));
  }
}
