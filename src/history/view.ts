import * as vscode from 'vscode';
import { isObject } from '../providers/contracts';
import { presentHistory } from './presentation';
import type { CompletionHistory, HistoryEntry } from './store';

export class HistoryView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private entries: readonly HistoryEntry[] = [];
  private revision = 0;
  private publishedRevision = 0;

  constructor(private readonly history: CompletionHistory, private readonly resources: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const webview = view.webview;
    webview.options = { enableScripts: true, localResourceRoots: [this.resources] };
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.resources, 'history.js'));
    const messages = webview.onDidReceiveMessage((message: unknown) => {
      if (this.view !== view || !isObject(message)) return;
      if (message.action === 'ready') this.refresh();
      if (message.action === 'open' && message.revision === this.publishedRevision && typeof message.index === 'number') {
        const entry = this.entries[message.index];
        if (entry) void vscode.commands.executeCommand('fimCompletion.viewCompletion', entry);
      }
    });
    const visibility = view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });
    view.onDidDispose(() => {
      messages.dispose();
      visibility.dispose();
      if (this.view === view) this.dispose();
    });
    webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src 'unsafe-inline'">
      <title>Completion History</title>
      <style>
        body{margin:0;padding:4px 8px 10px;background:var(--vscode-sideBar-background);color:var(--vscode-sideBar-foreground,var(--vscode-foreground));font:var(--vscode-font-size) var(--vscode-font-family)}
        h2{margin:10px 8px 4px;font-size:.92em;font-weight:600;color:var(--vscode-descriptionForeground)}
        ul{list-style:none;margin:0;padding:0}
        li+li{border-top:1px solid var(--vscode-sideBarSectionHeader-border,transparent)}
        button{display:block;width:100%;padding:7px 8px;border:0;border-radius:4px;color:inherit;background:none;text-align:left;cursor:pointer;font:inherit}
        button:hover{background:var(--vscode-list-hoverBackground)}
        button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
        code,.no-insertion{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        code{font-family:var(--vscode-editor-font-family,monospace)}
        .no-insertion,.metadata,#history-status{color:var(--vscode-descriptionForeground)}
        .metadata{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 8px;margin-top:4px;font-size:.85em;font-variant-numeric:tabular-nums}
        #history-status{margin:8px}
      </style></head><body>
      <p id="history-status" role="status">Loading history…</p>
      <main id="history" aria-label="Recent completions"></main>
      <script src="${script}"></script></body></html>`;
  }

  refresh(): void {
    const view = this.view;
    if (!view?.visible) return;
    const revision = ++this.revision;
    void this.history.recent().then(
      (entries) => this.publish(view, revision, entries),
      () => this.publish(view, revision, [], 'Completion history could not be read.'),
    );
  }

  private publish(view: vscode.WebviewView, revision: number, entries: readonly HistoryEntry[], error?: string): void {
    if (this.view !== view || this.revision !== revision) return;
    this.entries = entries;
    this.publishedRevision = revision;
    void view.webview.postMessage({ revision, groups: presentHistory(entries), error });
  }

  dispose(): void {
    this.view = undefined;
    this.entries = [];
  }
}
