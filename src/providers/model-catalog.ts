// Catalogs do not consistently expose a coding capability flag. Include known
// coding-capable text families and models explicitly classified as code.
const CODING_FAMILY = /^(?:gpt-(?:[56](?:\.\d+)*|4(?:\.1|o))|o[134]|codex|claude-(?:\d|opus|sonnet|haiku|fable)|qwen.*coder|starcoder2?|deepseek-(?:coder|r1|v[3-9])|codestral|devstral|glm-[45]|kimi-k2|gemini-[23]|grok-[34]|gpt-oss)(?:[-.:_]|$)/i;
const NON_CODING_VARIANT = /(?:^|[-_:])(?:image|audio|tts|realtime|transcribe|whisper|embedding|moderation|rerank|search|deep-research|safety|guard)(?:[-_:]|$)/i;

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
