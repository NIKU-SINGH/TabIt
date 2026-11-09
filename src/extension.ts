import { COMPLETION_SCHEMES, EditorCompletionTrigger, TRIGGER_INLINE_SUGGESTION } from './completion/editor-trigger';
import { SettingsView, escapeHtml } from './settings/view';
import { CompletionHistory } from './history/store';
import type { HistoryEntry } from './history/store';
import { HistoryView } from './history/view';
import type { Selection } from './providers/types';
import * as vscode from 'vscode';
import { CodeContext, CompletionMode, cleanInsertion } from './completion/infill';
import { CloudClient, CloudError, CloudProtocolError, PROVIDERS, ProviderId, createSelection, restoreSelection } from './providers/cloud-client';

const SECTION = 'fimCompletion';
const SELECTION_KEY = 'selection';
const PREFIX_LIMIT = 8_000;
const SUFFIX_LIMIT = 2_048;

type Pick<T> = vscode.QuickPickItem & { readonly value: T };

function settings(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

function keyName(provider: ProviderId): string {
  return `${SECTION}.key.${provider}`;
}

function readContext(document: vscode.TextDocument, cursor: vscode.Position): CodeContext {
  const offset = document.offsetAt(cursor);
  const start = document.positionAt(Math.max(0, offset - PREFIX_LIMIT));
  const end = document.positionAt(offset + SUFFIX_LIMIT);
  return {
    language: document.languageId,
    prefix: document.getText(new vscode.Range(start, cursor)),
    suffix: document.getText(new vscode.Range(cursor, end)),
  };
}

async function pickProvider(current?: ProviderId): Promise<ProviderId | undefined> {
  const choices: Pick<ProviderId>[] = Object.values(ProviderId).map((value) => ({
    label: PROVIDERS[value].label,
    description: value === current ? 'Current' : '',
    value,
  }));
  return (await vscode.window.showQuickPick(choices, { title: 'Tabit provider' }))?.value;
}

async function saveKey(context: vscode.ExtensionContext, provider: ProviderId): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: `${PROVIDERS[provider].label} API key`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (input) => input.trim() && !/\s/.test(input.trim())
      ? undefined
      : 'Enter an API key without spaces.',
  });
  if (value === undefined) return undefined;
  const key = value.trim();
  await context.secrets.store(keyName(provider), key);
  return key;
}

function errorMessage(error: unknown): string {
  if (error instanceof CloudProtocolError) return error.message;
  if (error instanceof CloudError) {
    const hint = {
      400: 'Check whether the model supports the selected completion mode.',
      401: 'Check the API key.',
      403: 'Check API key permissions and model access.',
      404: 'Check the model ID and completion mode.',
      429: 'Check rate limits and account quota.',
    }[error.status];
    return hint ? `${error.message} ${hint}` : error.message;
  }
  if (error instanceof Error && error.name === 'TimeoutError') return 'The provider request timed out.';
  return 'The provider request failed. Check your connection, model, and completion mode.';
}

async function pickModel(
  client: CloudClient,
  provider: ProviderId,
  key: string,
  current?: string,
): Promise<string | undefined> {
  const manual: Pick<string> = { label: '$(edit) Enter a model ID', value: '' };
  let choices: Pick<string>[] = [manual];
  try {
    const models = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Loading ${PROVIDERS[provider].label} models`,
      cancellable: true,
    }, async (_progress, token) => {
      const cancel = new AbortController();
      const listener = token.onCancellationRequested(() => cancel.abort());
      if (token.isCancellationRequested) cancel.abort();
      try {
        return await client.listModels(provider, key,
          AbortSignal.any([cancel.signal, AbortSignal.timeout(10_000)]));
      } finally {
        listener.dispose();
      }
    });
    choices = [manual, ...models.map(({ id, name }) => ({
      label: name,
      description: id === current ? `${id} (current)` : id,
      value: id,
    }))];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return undefined;
    void vscode.window.showWarningMessage(`Tabit: ${errorMessage(error)} You can enter a model ID manually.`);
  }

  const picked = await vscode.window.showQuickPick(choices, {
    title: 'Select a model',
    matchOnDescription: true,
  });
  if (!picked || picked.value) return picked?.value;
  const input = await vscode.window.showInputBox({
    title: 'Enter the provider’s model ID',
    value: current ?? '',
    validateInput: (value) => value.trim() ? undefined : 'A model ID is required.',
  });
  return input?.trim();
}

async function pickMode(provider: ProviderId): Promise<CompletionMode | undefined> {
  const choices: Pick<CompletionMode>[] = [
    { label: 'Prompted infill', description: 'For chat and instruction models', value: 'prompted' },
    { label: 'Native FIM (Qwen)', description: 'Requires a compatible raw completion route', value: 'qwen' },
    { label: 'Native FIM (StarCoder)', description: 'Requires a compatible raw completion route', value: 'starcoder' },
  ];
  const available = choices.filter(({ value }) => PROVIDERS[provider].inference[value]);
  if (available.length === 1) return available[0]?.value;
  return (await vscode.window.showQuickPick(available, { title: 'Select a completion mode' }))?.value;
}

export function activate(context: vscode.ExtensionContext): void {
  const client = new CloudClient();
  const output = vscode.window.createOutputChannel('Tabit', { log: true });
  const development = context.extensionMode === vscode.ExtensionMode.Development;

  function log(level: 'info' | 'warn' | 'debug', message: string, details?: object): void {
    if (details) output[level](message, details);
    else output[level](message);
    if (development) {
      const line = `[Tabit] [${level}] ${message}`;
      if (details) console.log(line, details);
      else console.log(line);
    }
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
  let activeRequest: AbortController | undefined;
  let selection = restoreSelection(context.globalState.get<unknown>(SELECTION_KEY));
  let lastLoggedError = '';
  let lastSkipReason = '';
  let requestSequence = 0;
  const editorTrigger = new EditorCompletionTrigger(
    (document) => settings().get<boolean>('automatic', true)
      && vscode.workspace.getConfiguration('editor', document).get<boolean>('inlineSuggest.enabled', true),
    () => settings().get<number>('debounceMs', 300),
    () => log('warn', 'VS Code could not trigger an inline suggestion.'),
  );

  function skipped(reason: string, automatic: boolean): vscode.InlineCompletionItem[] {
    if (!automatic || lastSkipReason !== reason) {
      log('info', 'Completion skipped', { reason, trigger: automatic ? 'automatic' : 'manual' });
    }
    lastSkipReason = reason;
    return [];
  }
  const settingsView = new SettingsView(vscode.Uri.joinPath(context.extensionUri, 'resources'), () => selection, settings, {
    models: async (provider) => {
      const key = await context.secrets.get(keyName(provider));
      if (!key) return undefined;
      return client.listModels(provider, key, AbortSignal.timeout(10_000));
    },
    select: saveSelection,
    getKey: async (provider) => context.secrets.get(keyName(provider)),
    setKey: async (provider, key) => { await context.secrets.store(keyName(provider), key); },
    removeKey: async (provider) => { await context.secrets.delete(keyName(provider)); },
  });
  const history = new CompletionHistory(
    vscode.Uri.joinPath(context.globalStorageUri, 'code-completions').fsPath,
    vscode.Uri.joinPath(context.globalStorageUri, '..', 'local-fim.fim-completion', 'code-completions').fsPath,
  );
  const historyView = new HistoryView(history);

  function refreshStatus(): void {
    status.command = `${SECTION}.configure`;
    status.text = selection ? `$(code) ${PROVIDERS[selection.provider].label}` : '$(code) Set up Tabit';
    const automatic = settings().get<boolean>('automatic', true);
    status.tooltip = selection
      ? `Tabit • ${selection.model} • ${selection.mode} • ${automatic ? 'Automatic' : 'Manual'}`
      : 'Select a provider and model for inline code completion';
    status.show();
    log('info', 'Completion configuration', {
      automatic,
      inlineSuggestions: vscode.workspace.getConfiguration('editor').get<boolean>('inlineSuggest.enabled'),
      provider: selection?.provider,
      model: selection?.model,
      mode: selection?.mode,
    });
    settingsView.refresh();
  }

  function invalidate(): void {
    activeRequest?.abort();
    editorTrigger.cancel();
    lastLoggedError = '';
    lastSkipReason = '';
  }

  async function saveSelection(next: Selection): Promise<void> {
    await context.globalState.update(SELECTION_KEY, next);
    selection = next;
    invalidate();
    refreshStatus();
  }

  async function configure(): Promise<void> {
    const provider = await pickProvider(selection?.provider);
    if (!provider) return;
    const key = await context.secrets.get(keyName(provider)) ?? await saveKey(context, provider);
    if (!key) return;
    const model = await pickModel(client, provider, key, selection?.provider === provider ? selection.model : undefined);
    if (!model) return;
    const mode = await pickMode(provider);
    if (!mode) return;
    const next = createSelection(provider, model, mode);
    if (!next) return;
    await saveSelection(next);
  }

  const inlineProvider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(document, position, trigger, token): Promise<vscode.InlineCompletionItem[]> {
      const config = settings();
      const scheduled = editorTrigger.isScheduled(document, position);
      const automatic = scheduled || trigger.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;
      if (token.isCancellationRequested) return [];
      if (automatic && !config.get<boolean>('automatic', true)) {
        return skipped('Automatic suggestions are off in Tabit Settings.', automatic);
      }
      // Editor events own the automatic debounce. Native typing callbacks must
      // not start a second request for the same edit.
      if (automatic && !scheduled) return [];
      if (trigger.selectedCompletionInfo) return skipped('The editor suggestion widget has an active item.', automatic);
      if (!selection) {
        if (!automatic) void vscode.window.showInformationMessage('Run Tabit: Select Provider and Model to set up inline suggestions.');
        return skipped('No provider and model selected.', automatic);
      }

      const target = selection;
      const requestId = ++requestSequence;
      const started = Date.now();
      const metadata = { requestId, provider: target.provider, model: target.model, mode: target.mode,
        trigger: scheduled ? 'editor-event' : automatic ? 'automatic' : 'manual' };
      const version = document.version;
      activeRequest?.abort();
      const request = new AbortController();
      activeRequest = request;
      const listener = token.onCancellationRequested(() => request.abort());
      let dispatched = false;

      try {
        const key = await context.secrets.get(keyName(target.provider));
        if (request.signal.aborted || document.version !== version || document.isClosed) return [];
        if (!key) {
          if (!automatic) void vscode.window.showWarningMessage(`Set an API key for ${PROVIDERS[target.provider].label} first.`);
          return skipped(`No API key saved for ${PROVIDERS[target.provider].label}.`, automatic);
        }

        const code = readContext(document, position);
        if (!code.prefix.trim() && !code.suffix.trim()) return skipped('The editor has no code near the cursor.', automatic);
        lastSkipReason = '';
        const timeoutMs = config.get<number>('timeoutMs', 10_000);
        const maxOutputTokens = config.get<number>('maxOutputTokens', 256);
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = AbortSignal.any([request.signal, timeout]);
        dispatched = true;
        const sent = Date.now();
        log('info', 'Completion request', { ...metadata, language: code.language, timeoutMs, maxOutputTokens,
          prefixLength: code.prefix.length, suffixLength: code.suffix.length });
        const result = await client.complete(target, key, code, maxOutputTokens, signal);
        const insertion = cleanInsertion(result.text, code.suffix);
        const stale = signal.aborted || document.version !== version || document.isClosed;
        log('info', 'Completion response', { ...metadata, elapsedMs: Date.now() - sent,
          totalTokens: result.totalTokens, outputLength: result.text.length, insertionLength: insertion.length,
          outcome: stale ? 'discarded' : insertion ? 'returned' : 'empty' });
        void history.record({
          timestamp: new Date().toISOString(),
          provider: target.provider,
          model: target.model,
          language: code.language,
          text: insertion,
          totalTokens: result.totalTokens,
        }).then(() => historyView.refresh(), () => log('warn', 'Could not save completion history.'));
        if (stale) return [];

        lastLoggedError = '';
        if (!insertion) return [];
        const text = document.eol === vscode.EndOfLine.CRLF ? insertion.replace(/\n/g, '\r\n') : insertion;
        return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
      } catch (error) {
        if (request.signal.aborted || token.isCancellationRequested || document.version !== version) {
          if (scheduled && token.isCancellationRequested && document.version === version) {
            editorTrigger.retryCanceled(document, position);
          }
          log('debug', 'Completion canceled', { ...metadata, elapsedMs: Date.now() - started,
            stage: dispatched ? 'in-flight' : 'before dispatch',
            reason: document.version !== version ? 'document changed'
              : token.isCancellationRequested ? 'VS Code canceled the suggestion' : 'request superseded',
          });
          return [];
        }
        const message = errorMessage(error);
        log('warn', 'Completion failed', { ...metadata, elapsedMs: Date.now() - started, message,
          status: error instanceof CloudError ? error.status : undefined });
        if (!automatic || message !== lastLoggedError) void vscode.window.showWarningMessage(`Tabit: ${message}`);
        lastLoggedError = message;
        return [];
      } finally {
        listener.dispose();
        if (activeRequest === request) activeRequest = undefined;
      }
    },
  };

  function command(name: string, run: (argument: unknown) => Promise<void>): vscode.Disposable {
    return vscode.commands.registerCommand(`${SECTION}.${name}`, async (argument: unknown) => {
      try {
        await run(argument);
      } catch {
        void vscode.window.showErrorMessage('Tabit could not update its settings or secure storage.');
      }
    });
  }

  context.subscriptions.push(
    output,
    status,
    settingsView,
    historyView,
    editorTrigger,
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document === event.document && event.contentChanges.length) {
        log('debug', 'Editor text changed', { language: event.document.languageId,
          version: event.document.version, changes: event.contentChanges.length });
        editorTrigger.schedule(editor);
      }
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor === vscode.window.activeTextEditor) {
        log('debug', 'Editor caret or selection changed', { language: event.textEditor.document.languageId,
          kind: event.kind, selections: event.selections.length });
        editorTrigger.schedule(event.textEditor);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => editorTrigger.cancel()),
    // Keep the original view ID so VS Code can restore its saved layout.
    vscode.window.registerTreeDataProvider('fimCompletion.settings', historyView),
    { dispose: invalidate },
    context.secrets.onDidChange(({ key }) => {
      if (selection && key === keyName(selection.provider)) invalidate();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SECTION)) {
        invalidate();
        refreshStatus();
      }
    }),
    command('configure', () => configure()),
    command('trigger', async () => {
      editorTrigger.cancel();
      const editor = vscode.window.activeTextEditor;
      if (!editor || !COMPLETION_SCHEMES.some((scheme) => scheme === editor.document.uri.scheme)) {
        void vscode.window.showInformationMessage('Tabit: Open a code editor to request an inline suggestion.');
        return;
      }
      if (!vscode.workspace.getConfiguration('editor', editor.document).get<boolean>('inlineSuggest.enabled', true)) {
        void vscode.window.showWarningMessage('Tabit: Enable Editor: Inline Suggest in VS Code Settings.');
        return;
      }
      await vscode.commands.executeCommand(TRIGGER_INLINE_SUGGESTION);
    }),
    command('openSettings', async () => settingsView.show()),
    command('refreshHistory', async () => historyView.refresh()),
    vscode.commands.registerCommand('fimCompletion.viewCompletion', (entry: HistoryEntry) => {
      if (typeof entry?.text !== 'string') return;
      const panel = vscode.window.createWebviewPanel('fimCompletion.entry', 'Completion',
        vscode.ViewColumn.Active, { localResourceRoots: [] });
      panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
        <title>Completion</title></head><body><h1>Completion</h1>
        <pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(entry.text || 'No insertion returned')}</pre></body></html>`;
    }),
    command('setKey', async () => {
      const provider = await pickProvider(selection?.provider);
      if (provider) await saveKey(context, provider);
    }),
    command('removeKey', async () => {
      const provider = await pickProvider(selection?.provider);
      if (provider) await context.secrets.delete(keyName(provider));
    }),
    command('toggle', async () => {
      const config = settings();
      await config.update('automatic', !config.get<boolean>('automatic', true), vscode.ConfigurationTarget.Global);
    }),
    vscode.languages.registerInlineCompletionItemProvider(
      COMPLETION_SCHEMES.map((scheme) => ({ scheme })),
      inlineProvider,
    ),
  );
  refreshStatus();
}
