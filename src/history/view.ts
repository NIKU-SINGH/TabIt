import * as vscode from 'vscode';
import type { CompletionHistory, HistoryEntry } from './store';
import { PROVIDERS } from '../providers/cloud-client';

export class HistoryView implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changes.event;

  constructor(private readonly history: CompletionHistory) {}

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    try {
      const entries = await this.history.recent();
      return entries.length ? entries.map((entry) => this.item(entry)) : [
        new vscode.TreeItem('No completions yet'),
      ];
    } catch {
      return [new vscode.TreeItem('Completion history could not be read')];
    }
  }

  refresh(): void {
    this.changes.fire();
  }

  dispose(): void {
    this.changes.dispose();
  }

  private item(entry: HistoryEntry): vscode.TreeItem {
    const preview = entry.text.trim().split(/\r?\n/, 1)[0]?.slice(0, 100);
    const time = new Date(entry.timestamp);
    const tokens = entry.totalTokens === null ? 'Tokens unavailable' : `${entry.totalTokens.toLocaleString()} tokens`;
    const item = new vscode.TreeItem(preview || 'No insertion returned');
    item.description = `${time.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })} · ${tokens}`;
    item.tooltip = `${PROVIDERS[entry.provider].label} · ${entry.model}\n${time.toLocaleString()} · ${tokens}\n\n${entry.text}`;
    item.command = { command: 'fimCompletion.viewCompletion', title: 'View Completion', arguments: [entry] };
    return item;
  }
}
