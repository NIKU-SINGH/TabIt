import type { HistoryEntry } from './store';

interface HistoryRow {
  readonly index: number;
  readonly preview: string;
  readonly time: string;
  readonly tokens: string;
}

interface HistoryGroup {
  readonly date: string;
  readonly rows: HistoryRow[];
}

export function presentHistory(entries: readonly HistoryEntry[]): HistoryGroup[] {
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
  const numberFormat = new Intl.NumberFormat();
  const groups = new Map<string, HistoryGroup>();
  for (const [index, entry] of entries.entries()) {
    const timestamp = new Date(entry.timestamp);
    const date = dateFormat.format(timestamp);
    let group = groups.get(date);
    if (!group) {
      group = { date, rows: [] };
      groups.set(date, group);
    }
    group.rows.push({
      index,
      preview: entry.text.trim().split(/\r?\n/, 1)[0]?.slice(0, 160) ?? '',
      time: timeFormat.format(timestamp),
      tokens: entry.totalTokens === null ? 'Tokens unavailable' : `${numberFormat.format(entry.totalTokens)} tokens`,
    });
  }
  return [...groups.values()];
}
