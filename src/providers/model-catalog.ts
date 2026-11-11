import type { Model } from './types';

// Catalogs do not consistently expose a coding capability flag. Include known
// coding-capable text families and models explicitly classified as code.
const CODING_FAMILY = /^(?:gpt-(?:[56](?:\.\d+)*|4(?:\.1|o))|o[134]|codex|claude-(?:\d|opus|sonnet|haiku|fable)|qwen.*coder|starcoder2?|deepseek-(?:coder|r1|v[3-9])|codestral|devstral|glm-[45]|kimi-k[23]|minimax-m[23]|gemini-[23]|grok-[34]|gpt-oss)(?:[-.:_]|$)/i;
const NON_CODING_VARIANT = /(?:^|[-_:])(?:image|audio|tts|realtime|transcribe|whisper|embedding|moderation|rerank|search|batch|deep-research|safety|guard)(?:[-_:]|$)/i;

function modelSlug(id: string): string {
  return id.split('/').at(-1) ?? id;
}

export function isCodingModel(id: string, type?: string): boolean {
  const slug = modelSlug(id);
  return !NON_CODING_VARIANT.test(slug) && (type?.toLowerCase() === 'code' || CODING_FAMILY.test(slug));
}

const BRAND_WORDS: Readonly<Record<string, string>> = {
  gpt: 'GPT', glm: 'GLM', oss: 'OSS', qwen: 'Qwen', deepseek: 'DeepSeek', starcoder: 'StarCoder',
  starcoder2: 'StarCoder2', ai: 'AI',
};

export function modelTitle(id: string, catalogName?: string): string {
  const slug = modelSlug(id);
  if (catalogName && catalogName !== id && catalogName !== slug) return catalogName;
  const date = slug.match(/-(\d{4}-\d{2}-\d{2}|\d{8})$/);
  const stem = date ? slug.slice(0, date.index) : slug;
  const title = stem
    .replace(/^(claude-(?:opus|sonnet|haiku|fable))-(\d+)-(\d+)(?=-|$)/i, '$1-$2.$3')
    .split(/[-_]+/)
    .map((word) => BRAND_WORDS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .replace(/^GPT (?=\d)/, 'GPT-');
  return date ? `${title} (${date[1]})` : title;
}

export function hasModelAlias(id: string, models: ReadonlyMap<string, unknown>): boolean {
  const alias = id.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, '');
  return alias !== id && models.has(alias);
}

const MODEL_FAMILIES = [
  { label: 'Claude', icon: 'claude-color', slug: /^claude(?:-|$)/i },
  { label: 'DeepSeek', icon: 'deepseek-color', slug: /^deepseek(?:-|$)/i },
  { label: 'GLM', icon: 'zai', slug: /^glm(?:-|$)/i },
  { label: 'Gemini', icon: 'gemini-color', slug: /^gemini(?:-|$)/i },
  { label: 'Grok', icon: 'grok', slug: /^grok(?:-|$)/i },
  { label: 'Kimi', icon: 'kimi-color', slug: /^kimi(?:-|$)/i },
  { label: 'MiniMax', icon: 'minimax-color', slug: /^minimax(?:-|$)/i },
  { label: 'Mistral', icon: 'mistral-color', slug: /^(?:mistral|codestral|devstral)(?:-|$)/i },
  { label: 'OpenAI', icon: 'openai', slug: /^(?:gpt|o[134]|codex)(?:-|$)/i },
  { label: 'Qwen', icon: 'qwen-color', slug: /^qwen(?:\d|[-.]|$)/i },
  { label: 'StarCoder', icon: 'huggingface-color', slug: /^starcoder2?(?:-|$)/i },
] as const;

export function modelFamily(id: string): (typeof MODEL_FAMILIES)[number] | undefined {
  const slug = modelSlug(id);
  return MODEL_FAMILIES.find((family) => family.slug.test(slug));
}

interface ModelGroup {
  readonly label: string;
  readonly icon: (typeof MODEL_FAMILIES)[number]['icon'] | undefined;
  readonly models: Model[];
}

export function groupModels(models: readonly Model[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const model of models) {
    const family = modelFamily(model.id);
    const slash = model.id.indexOf('/');
    const namespace = slash > 0 ? model.id.slice(0, slash) : undefined;
    const name = namespace ? model.name.match(/^([^:]+):\s+(.+)$/) : undefined;
    const label = family?.label ?? name?.[1] ?? (namespace ? modelTitle(namespace) : 'Other models');
    const key = family ? `family:${family.label}` : namespace?.toLowerCase() ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { label, icon: family?.icon, models: [] };
      groups.set(key, group);
    }
    group.models.push({ id: model.id, name: name?.[2] ?? model.name });
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}
