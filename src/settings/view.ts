import { dirname } from 'node:path';
import * as vscode from 'vscode';
import { PROVIDERS, ProviderId } from '../providers/cloud-client';
import type { Selection } from '../providers/types';

import type { Model } from '../providers/types';
import { groupModels, modelTitle } from '../providers/model-catalog';
import { isObject } from '../providers/contracts';

const icons = vscode.Uri.joinPath(
  vscode.Uri.file(dirname(require.resolve('@lobehub/icons-static-svg/package.json'))),
  'icons',
);

function iconUri(webview: vscode.Webview, name: string): string {
  return webview.asWebviewUri(vscode.Uri.joinPath(icons, `${name}.svg`)).toString();
}

const MONOCHROME_ICONS = new Set(['openai', 'zai', 'grok']);

export const MODE_LABELS = {
  prompted: 'Prompted infill',
  qwen: 'Native FIM (Qwen)',
  starcoder: 'Native FIM (StarCoder)',
} as const;

interface SettingsActions {
  readonly models: (provider: ProviderId) => Promise<readonly Model[] | undefined>;
  readonly select: (selection: Selection) => Promise<void>;
  readonly getKey: (provider: ProviderId) => Promise<string | undefined>;
  readonly setKey: (provider: ProviderId, key: string) => Promise<void>;
  readonly removeKey: (provider: ProviderId) => Promise<void>;
}

export const NUMERIC_SETTINGS = {
  debounceMs: { label: 'Typing delay', fallback: 300, min: 0, max: 2000, unit: 'ms' },
  timeoutMs: { label: 'Request timeout', fallback: 10000, min: 1000, max: 60000, unit: 'ms' },
  maxOutputTokens: { label: 'Output token limit', fallback: 256, min: 32, max: 4096, unit: 'tokens' },
} as const;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function keyPreview(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const [first, second] = Array.from(key);
  return `${second === undefined ? '' : first}••••••`;
}

function row(label: string, value: string, action: string): string {
  return `<div class="row"><div><strong>${label}</strong><div class="detail">${escapeHtml(value)}</div></div>${action}</div>`;
}

function popover(id: string, label: string, title: string, content: string): string {
  return `<div class="control">
    <button type="button" class="trigger" popovertarget="${id}" style="anchor-name:--${id}">
      ${label} <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
        <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div id="${id}" class="popover" popover aria-labelledby="${id}-title" style="position-anchor:--${id}">
      <div id="${id}-title" class="popover-title">${title}</div>${content}
    </div>
  </div>`;
}

function option(action: string, value: string, label: string, current: boolean): string {
  return `<button type="button" class="option" data-action="${action}" data-value="${escapeHtml(value)}"${current ? ' aria-current="true"' : ''}>
    ${label}${current ? '<span class="current">Current</span>' : ''}
  </button>`;
}

export class SettingsView implements vscode.Disposable {
  private draftProvider: ProviderId | undefined;
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly resources: vscode.Uri,
    private readonly currentSelection: () => Selection | undefined,
    private readonly settings: () => vscode.WorkspaceConfiguration,
    private readonly actions: SettingsActions,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('fimCompletion.settingsEditor', 'Tabit Settings',
      vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [this.resources, icons],
      });
    this.panel = panel;
    const messages = panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(panel, message).catch(() => {
        const action = isObject(message) ? message.action : undefined;
        const detail = action === 'key' ? 'Could not save the API key.'
          : action === 'removeKey' ? 'Could not remove the saved API key.'
          : action === 'keyStatus' ? 'Could not read the saved API key status.'
          : 'Could not update the setting.';
        if (action === 'key' || action === 'removeKey') void panel.webview.postMessage({ type: 'keyFailed' });
        if (action === 'number' || action === 'automatic') this.refresh();
        void vscode.window.showErrorMessage(`Tabit: ${detail}`);
      });
    });
    panel.onDidDispose(() => {
      messages.dispose();
      this.panel = undefined;
      this.draftProvider = undefined;
    });
    this.refresh();
  }

  refresh(): void {
    const panel = this.panel;
    if (!panel) return;
    const selection = this.currentSelection();
    const settings = this.settings();
    const automatic = settings.get<boolean>('automatic', true);
    const provider = this.draftProvider ?? selection?.provider;
    const selectedModel = selection?.provider === provider ? selection?.model : undefined;
    const selectedModelTitle = selectedModel ? modelTitle(selectedModel) : undefined;
    const providerIcon = (id: ProviderId): string => escapeHtml(iconUri(panel.webview, id));
    const providerLabel = (id: ProviderId): string => {
      return `<img class="provider-icon" src="${providerIcon(id)}" alt="" width="18" height="18"><span>${escapeHtml(PROVIDERS[id].label)}</span>`;
    };
    const providerOptions = Object.values(ProviderId)
      .map((id) => option('provider', id, providerLabel(id), id === provider)).join('');
    const mode = selection ? MODE_LABELS[selection.mode] : 'Choose a provider and model first';
    const modeOptions = selection ? Object.entries(MODE_LABELS)
      .filter(([key]) => PROVIDERS[selection.provider].inference[key as keyof typeof MODE_LABELS])
      .map(([key, label]) => option('mode', key, label, key === selection.mode)).join('') : '';
    const numbers = Object.entries(NUMERIC_SETTINGS).map(([key, setting]) => {
      const value = settings.get<number>(key, setting.fallback);
      return row(setting.label, `Whole number from ${setting.min} to ${setting.max}`,
        `<label class="numeric-control"><input data-setting="${key}" type="number" min="${setting.min}" max="${setting.max}"
        step="1" value="${escapeHtml(String(value))}" aria-label="${setting.label} in ${setting.unit}" required><span>${setting.unit}</span></label>`);
    }).join('');
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.resources, 'settings.js'));
    panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource}; script-src ${panel.webview.cspSource}; style-src 'unsafe-inline'">
      <title>Tabit Settings</title>
      <style>
      body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font:var(--vscode-font-size) var(--vscode-font-family)}
      main{max-width:860px;margin:40px auto;padding:0 20px}
      h1{display:flex;align-items:center;gap:10px;font-size:2em;font-weight:500;margin-bottom:6px}h2{margin:28px 0 10px;font-weight:500}
      p,.detail{color:var(--vscode-descriptionForeground)}.detail{margin-top:5px;overflow-wrap:anywhere}
      section{border:1px solid var(--vscode-widget-border,var(--vscode-editorGroup-border));border-radius:8px}
      .row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 16px}
      .row+.row{border-top:1px solid var(--vscode-editorGroup-border)}
      button{font:inherit;cursor:pointer;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);padding:5px 9px;border:1px solid transparent;border-radius:5px}
      button:hover{background:var(--vscode-button-secondaryHoverBackground)}
      button:focus-visible,input:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
      .control{flex:none}.trigger{display:flex;align-items:center;gap:8px}
      .popover{position:fixed;inset:auto;position-area:bottom span-left;justify-self:end;align-self:start;position-try-fallbacks:flip-block;box-sizing:border-box;margin:6px 0;width:min(280px,calc(100vw - 24px));max-height:min(420px,70vh);overflow:auto;padding:0;border:1px solid var(--vscode-widget-border,var(--vscode-editorGroup-border));border-radius:8px;background:var(--vscode-editor-background);color:var(--vscode-foreground);box-shadow:0 6px 20px var(--vscode-widget-shadow,#0006)}
      .popover-title{padding:8px 11px 6px;border-bottom:1px solid var(--vscode-editorGroup-border);font-size:.75em;letter-spacing:.12em;text-transform:uppercase;color:var(--vscode-descriptionForeground)}
      .options{display:grid;gap:2px;padding:4px}
      .option{display:flex;align-items:center;text-align:left;overflow-wrap:anywhere;gap:8px;padding:5px 7px;background:transparent;color:inherit}
      .option:hover,.option:focus-visible,.option[aria-current]{background:var(--vscode-list-hoverBackground)}
      .provider-icon{flex:none;background:#f5f5f5;border-radius:3px;padding:2px}
      #models{overflow:hidden}
      #models:popover-open{display:flex;flex-direction:column}
      #models .search{padding:6px 10px;border-bottom:1px solid var(--vscode-editorGroup-border)}
      #model-list{min-height:0;overflow:auto}
      #model-status:empty,#model-list:empty{display:none}
      .catalog-header,.family-heading{display:flex;align-items:center;gap:8px;margin:0;font-size:inherit;font-weight:500}
      .catalog-header{position:sticky;top:0;padding:7px 10px;background:var(--vscode-editor-background);border-bottom:1px solid var(--vscode-editorGroup-border)}
      .catalog-count{margin-left:auto;padding:1px 6px;border-radius:999px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:.8em}
      .model-family{margin:6px 7px 6px 12px}
      .family-heading{padding:2px 0 4px;color:var(--vscode-descriptionForeground)}
      .family-icon{display:inline-block;width:16px;height:16px;flex:none}
      .family-icon.monochrome{background:currentColor;mask:var(--family-icon) center/contain no-repeat}
      .model-options{display:grid;margin-left:7px;padding-left:7px;border-left:1px solid var(--vscode-editorGroup-border)}
      .model-options .option{padding:3px 7px}
      .manual-model{border-top:1px solid var(--vscode-editorGroup-border);padding:7px 10px}
      .manual-model summary{cursor:pointer;color:var(--vscode-descriptionForeground)}
      .manual-model form{padding:6px 0 0}
      .current{margin-left:auto;color:var(--vscode-descriptionForeground);font-size:.85em}
      form,.search{display:grid;gap:8px;padding:8px 10px}
      input:not([type=checkbox]){box-sizing:border-box;width:100%;font:inherit;padding:5px 7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-widget-border,transparent));border-radius:4px}
      label input{margin-top:4px}.hint{padding:4px 10px;color:var(--vscode-descriptionForeground)}
      .numeric-control{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:none;color:var(--vscode-descriptionForeground)}
      .numeric-control input{width:90px;margin:0;text-align:right;font-variant-numeric:tabular-nums}
      .numeric-control span{min-width:40px}
      .key-form{padding:10px;gap:8px}
      .key-form input{margin:0}
      .key-actions{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px}
      .key-actions .save{color:var(--vscode-button-foreground);background:var(--vscode-button-background)}
      .key-actions .save:disabled{opacity:.5;cursor:default}
      .key-actions .save:not(:disabled):hover{background:var(--vscode-button-hoverBackground)}
      .key-actions .remove{background:transparent;color:var(--vscode-errorForeground)}
      .key-actions .remove:hover{background:var(--vscode-list-hoverBackground)}
      .switch{appearance:none;display:block;box-sizing:border-box;width:36px;height:20px;margin:0;border-radius:999px;border:1px solid var(--vscode-checkbox-border,var(--vscode-descriptionForeground));background:var(--vscode-input-background);cursor:pointer}
      .switch::before{content:"";display:block;width:12px;height:12px;margin:3px;border-radius:50%;background:var(--vscode-descriptionForeground)}
      .switch:checked{background:var(--vscode-button-background);border-color:var(--vscode-button-background)}
      .switch:checked::before{transform:translateX(16px);background:var(--vscode-button-foreground)}
      @media(max-width:440px){.row:has(.control){flex-wrap:wrap}}
      </style></head><body><main><h1><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
        <path d="M10 3h4l.6 2.5 2.1 1.2 2.5-.7 2 3.5-1.9 1.8v2.4l1.9 1.8-2 3.5-2.5-.7-2.1 1.2L14 22h-4l-.6-2.5-2.1-1.2-2.5.7-2-3.5 1.9-1.8v-2.4L2.8 9.5l2-3.5 2.5.7 2.1-1.2L10 3Z"/>
        <circle cx="12" cy="12.5" r="3"/>
      </svg>Tabit Settings</h1>
      <p>Choose how VS Code generates inline suggestions.</p>
      <h2>Provider and model</h2><section>
      ${row('Provider', provider ? PROVIDERS[provider].label : 'No provider selected', popover('providers', provider ? providerLabel(provider) : 'Choose provider', 'Select provider', `<div class="options">${providerOptions}</div>`))}
      ${row('Model', selectedModelTitle ?? (provider ? 'Choose a model to activate this provider' : 'Choose a provider first'), provider
        ? popover('models', 'Choose model', 'Select model', `<div class="search"><input id="model-search" type="search" placeholder="Search coding models" aria-label="Search coding models"></div>
          <div id="model-status" class="hint" role="status"></div><div id="model-list" data-provider="${escapeHtml(PROVIDERS[provider].label)}" data-icon="${providerIcon(provider)}"></div>
          <details class="manual-model"><summary>Enter a model ID</summary>
          <form data-action="model"><input name="value" aria-label="Model ID" required maxlength="500"><button type="submit">Use model ID</button></form></details>`) : '')}
      ${row('API key', provider ? PROVIDERS[provider].label : 'Choose a provider first', provider
        ? popover('api-key', 'Manage key', `API key · ${escapeHtml(PROVIDERS[provider].label)}`,
          `<form class="key-form" data-action="key" novalidate>
          <input name="value" type="password" aria-label="API key" placeholder="Paste API key" autocomplete="off" maxlength="4096" required>
          <div class="key-actions"><button class="save" type="submit" disabled>Save</button>
          <button class="remove" type="submit" value="removeKey" hidden>Remove</button></div></form>`) : '')}
      </section><h2>Completion</h2><section>
      ${row('Completion mode', mode, selection ? popover('modes', 'Change', 'Select completion mode', `<div class="options">${modeOptions}</div>`) : '')}
      ${row('Automatic suggestions', 'Request suggestions as you type', `<input class="switch" id="automatic" type="checkbox" role="switch" aria-label="Automatic suggestions"${automatic ? ' checked' : ''}>`)}
      ${numbers}</section>
      </main><script src="${escapeHtml(script.toString())}"></script></body></html>`;
  }

  private async handleMessage(panel: vscode.WebviewPanel, message: unknown): Promise<void> {
    if (!isObject(message) || this.panel !== panel) return;
    const { action, value } = message;
    const current = this.currentSelection();
    const provider = this.draftProvider ?? current?.provider;
    switch (action) {
      case 'provider': {
        const chosen = Object.values(ProviderId).find((id) => id === value);
        if (chosen) {
          this.draftProvider = chosen;
          this.refresh();
        }
        return;
      }
      case 'models': {
        if (!provider) return;
        try {
          const models = await this.actions.models(provider);
          if (this.panel === panel && (this.draftProvider ?? this.currentSelection()?.provider) === provider) {
            if (!models) void vscode.window.showWarningMessage(`Tabit: Add an API key for ${PROVIDERS[provider].label} to load its model catalog.`);
            const groups = groupModels(models ?? []).map(({ label, icon, models }) => ({
              label,
              models,
              icon: icon && iconUri(panel.webview, icon),
              monochrome: icon !== undefined && MONOCHROME_ICONS.has(icon),
            }));
            await panel.webview.postMessage({ type: 'models', groups, unavailable: !models,
              current: current?.provider === provider ? current.model : undefined });
          }
        } catch {
          if (this.panel === panel && (this.draftProvider ?? this.currentSelection()?.provider) === provider) {
            void vscode.window.showWarningMessage(`Tabit: Could not load models from ${PROVIDERS[provider].label}. Check your API key or connection, or enter a model ID manually.`);
            await panel.webview.postMessage({ type: 'models', groups: [], unavailable: true });
          }
        }
        return;
      }
      case 'model': {
        if (!provider || typeof value !== 'string' || !value.trim() || value.length > 500) {
          void vscode.window.showErrorMessage('Tabit: Enter a valid model ID.');
          return;
        }
        const handlers = PROVIDERS[provider].inference;
        const mode = current?.provider === provider && handlers[current.mode] ? current.mode
          : (Object.keys(MODE_LABELS) as Selection['mode'][]).find((key) => handlers[key]);
        if (mode) {
          await this.actions.select({ provider, model: value.trim(), mode });
          this.draftProvider = undefined;
        }
        return;
      }
      case 'mode':
        if (current && (value === 'prompted' || value === 'qwen' || value === 'starcoder')
          && PROVIDERS[current.provider].inference[value]) await this.actions.select({ ...current, mode: value });
        return;
      case 'automatic':
        if (typeof value === 'boolean') await this.settings().update('automatic', value, vscode.ConfigurationTarget.Global);
        return;
      case 'number': {
        const key = message.key;
        if (typeof key !== 'string' || !Object.hasOwn(NUMERIC_SETTINGS, key)) return;
        const { label, min, max } = NUMERIC_SETTINGS[key as keyof typeof NUMERIC_SETTINGS];
        if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) {
          await this.settings().update(key, value, vscode.ConfigurationTarget.Global);
        } else {
          this.refresh();
          void vscode.window.showErrorMessage(`Tabit: ${label} must be a whole number from ${min} to ${max}.`);
        }
        return;
      }
      case 'keyStatus':
        if (provider) {
          const key = await this.actions.getKey(provider);
          if (this.panel === panel && (this.draftProvider ?? this.currentSelection()?.provider) === provider) {
            await panel.webview.postMessage({ type: 'keyStatus', preview: keyPreview(key) });
          }
        }
        return;
      case 'key':
        if (provider && typeof value === 'string' && /^\S+$/.test(value.trim()) && value.length <= 4096) {
          const key = value.trim();
          await this.actions.setKey(provider, key);
          await panel.webview.postMessage({ type: 'keySaved', preview: keyPreview(key) });
          void vscode.window.showInformationMessage(`Tabit: API key saved for ${PROVIDERS[provider].label}.`);
        } else {
          await panel.webview.postMessage({ type: 'keyFailed' });
          void vscode.window.showErrorMessage('Tabit: Enter an API key without spaces.');
        }
        return;
      case 'removeKey':
        if (provider) {
          await this.actions.removeKey(provider);
          await panel.webview.postMessage({ type: 'keySaved' });
          void vscode.window.showInformationMessage(`Tabit: Saved API key removed for ${PROVIDERS[provider].label}.`);
        }
        return;
    }
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
