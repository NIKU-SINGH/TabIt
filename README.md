# Tabit

Tabit is a VS Code extension that fills the gap at your cursor using code before and after it. The insertion appears as inline ghost text. Accept it with Tab or dismiss it with Escape.

## Install and use

1. In VS Code 1.101 or later, open the Extensions view menu and choose **Install from VSIX…**, then select the packaged extension.
2. Click the **Tabit** icon in the Activity Bar, then click the gear at the top of **Completion History**. Open **Choose provider** on the settings page, then pick a provider from the inline list. Set its API key with **Manage key**, then use **Choose model** to search the catalog or enter a model ID. The same picker is available from the Command Palette and status bar.
3. Pick a provider, enter its API key, and select a model from the live catalog. You can also enter a model ID directly.
4. Open a code file and run **Tabit: Trigger Inline Suggestion**. Run **Tabit: Toggle Automatic Suggestions** to request completions after a pause in typing or after moving the caret.

The gear opens a settings page with provider, model, completion mode, API keys, automatic suggestions, and request limits. VS Code SecretStorage holds each provider’s key separately.

## Upgrading from the previous extension ID

Tabit now installs as `tabit.tabit`. VS Code stores API keys and the active provider and model separately for each extension ID, so set them again in Tabit. Existing VS Code preferences still apply. The history sidebar also reads records from the previous storage directory.

## Completion history

The sidebar shows the latest 100 recorded responses with their local time and provider-reported token counts. Select a row to open its completion text. The refresh button reloads history from disk. Successful responses with no insertion still appear because they may have used tokens. If a provider omits usage, the sidebar shows **Tokens unavailable**.

Each record is stored as a JSON file under the extension’s VS Code global storage directory, in `code-completions`. History is shared across workspaces on the same extension host. Records include generated insertion text and request metadata, without the original prompt or API key. History starts when you install this version.

## Providers and modes

| Provider | Prompted infill | Native FIM |
| --- | --- | --- |
| OpenAI Cloud | Responses API | |
| Anthropic | Messages API | |
| OpenRouter | Chat Completions API | Text Completions API with compatible model routes |
| Together AI | Chat Completions API | Text Completions API with compatible model routes |

Prompted infill gives an instruction model the prefix, suffix, and language and asks for the missing code. Native FIM uses the Qwen or StarCoder token template with a model and route that accept raw FIM prompts. Catalog availability can vary by account, and the catalog does not guarantee compatibility with every completion mode. If a route rejects native FIM, select a compatible base model or choose prompted infill with an instruction model.

## Request behavior

Each inference request sends up to 8,000 UTF-16 code units before the cursor and 2,048 after it from the active document. The selected provider processes this code under its API terms. Automatic suggestions are on by default once you configure a provider, model, and API key. You can turn them off in Tabit Settings. The extension disables itself in untrusted workspaces and does not log code, completions, keys, or provider response bodies.

VS Code settings under **Tabit** control the automatic debounce, request timeout, and output token budget. Open **Output → Tabit** for completion diagnostics. Requests and responses share a request ID and include timing, token usage when available, and whether the result was returned to VS Code. The log also reports common reasons a trigger was skipped. Reasoning models can use part or all of the output budget on reasoning tokens.

## Development

Use Node.js 22 or later.

```sh
npm ci
npm run package
```

Open this folder in VS Code and press F5 (Fn+F5 on some keyboards) with **Run Tabit** selected. VS Code starts the TypeScript watcher, waits for the first build, and launches the source in an Extension Development Host with other installed extensions disabled. Make edits in the development window and read the **Debug Console** in the original window for Tabit trigger and request diagnostics. Use **Restart Debugging** after changing extension source to load the watcher’s latest output.

 Packaging runs the strict TypeScript build and the test suite before creating the VSIX. Tests exercise FIM formatting, insertion cleanup, model discovery, and provider HTTP contracts using simulated responses. Run `npm test` for the checks alone.

### Project layout

- `src/extension.ts` wires VS Code activation, commands, and inline suggestions.
- `src/completion/` builds fill-in-the-middle prompts and prepares insertions.
- `src/providers/` contains the provider registry, Axios client, request DTOs, and response decoders.
- `src/history/` persists completion records and renders the sidebar.
- `src/settings/` renders the settings editor and provider picker.
- `test/` mirrors the source modules under test.
- `resources/` contains the Activity Bar icon and provider logos.

### Add a provider

1. Add a stable string value to `ProviderId` in `src/providers/types.ts`. VS Code uses this value for saved selections and the provider's SecretStorage key.
2. Register a `ProviderAdapter` under that enum value in `src/providers/adapters.ts`. Supply the label, base URL, model discovery function, and handlers for the supported completion modes. Override `authHeaders` when the provider uses a different authentication scheme.
3. Reuse an existing handler for a compatible API. For a new wire format, define its DTOs and runtime decoder and call the shared Axios client from the adapter. Add a contract test for the new route and payload.

The enum and registry drive the provider picker. The adapter's registered handlers determine which completion modes the picker offers.

Provider icons are bundled from [Lobe Icons](https://github.com/lobehub/lobe-icons). The license is included at `resources/providers/LICENSE`.
