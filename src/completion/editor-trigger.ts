import * as vscode from 'vscode';

export const COMPLETION_SCHEMES = ['file', 'untitled', 'vscode-remote'] as const;
export const TRIGGER_INLINE_SUGGESTION = 'editor.action.inlineSuggest.trigger';

interface Target {
  readonly editor: vscode.TextEditor;
  readonly position: vscode.Position;
  readonly version: number;
  readonly retry: boolean;
}

export class EditorCompletionTrigger implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private invoking: Target | undefined;

  constructor(
    private readonly enabled: (document: vscode.TextDocument) => boolean,
    private readonly delayMs: () => number,
    private readonly onError: () => void,
  ) {}

  schedule(editor: vscode.TextEditor): void {
    this.cancel();
    if (!this.canTrigger(editor)) return;
    this.enqueue({ editor, position: editor.selection.active, version: editor.document.version, retry: false }, this.delayMs());
  }

  retryCanceled(document: vscode.TextDocument, position: vscode.Position): void {
    const target = this.invoking;
    if (!target || target.retry || this.timer !== undefined || !this.matches(target, document, position)
      || !this.canTrigger(target.editor) || !target.editor.selection.active.isEqual(position)) return;
    this.enqueue({ ...target, retry: true }, this.delayMs());
  }

  private enqueue(target: Target, delay: number): void {
    const { editor } = target;
    this.timer = setTimeout(() => {
      this.cancel();
      if (!this.canTrigger(editor) || !this.matches(target, editor.document, editor.selection.active)) return;
      this.invoking = target;
      void Promise.resolve(vscode.commands.executeCommand(TRIGGER_INLINE_SUGGESTION))
        .catch(this.onError)
        .finally(() => { if (this.invoking === target) this.invoking = undefined; });
    }, delay);
  }

  isScheduled(document: vscode.TextDocument, position: vscode.Position): boolean {
    return this.matches(this.invoking, document, position);
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.cancel();
    this.invoking = undefined;
  }

  private canTrigger(editor: vscode.TextEditor): boolean {
    return editor === vscode.window.activeTextEditor && !editor.document.isClosed
      && editor.selections.length === 1 && editor.selection.isEmpty
      && COMPLETION_SCHEMES.some((scheme) => scheme === editor.document.uri.scheme)
      && this.enabled(editor.document);
  }

  private matches(target: Target | undefined, document: vscode.TextDocument, position: vscode.Position): boolean {
    return target !== undefined && target.editor.document === document
      && target.version === document.version && target.position.isEqual(position);
  }
}
