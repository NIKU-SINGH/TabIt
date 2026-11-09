import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isObject } from '../providers/contracts';
import { ProviderId } from '../providers/types';

export interface HistoryEntry {
  readonly timestamp: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly language: string;
  readonly text: string;
  readonly totalTokens: number | null;
}

const ENTRY_NAME = /^\d{13}-[0-9a-f-]{36}\.json$/;

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return isObject(value) && typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp))
    && Object.values(ProviderId).some((id) => id === value.provider)
    && typeof value.model === 'string' && typeof value.language === 'string' && typeof value.text === 'string'
    && (value.totalTokens === null || (typeof value.totalTokens === 'number'
      && Number.isSafeInteger(value.totalTokens) && value.totalTokens >= 0));
}

export class CompletionHistory {
  constructor(readonly directory: string, private readonly previousDirectory?: string) {}

  async record(entry: HistoryEntry): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const name = `${Date.parse(entry.timestamp)}-${randomUUID()}.json`;
    const destination = join(this.directory, name);
    const temporary = destination + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify(entry) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async recent(limit = 100): Promise<HistoryEntry[]> {
    const directories = this.previousDirectory ? [this.directory, this.previousDirectory] : [this.directory];
    const lists = await Promise.all(directories.map(async (directory) => {
      try {
        return (await readdir(directory)).filter((name) => ENTRY_NAME.test(name))
          .map((name) => ({ name, directory }));
      } catch (error) {
        if (isObject(error) && error.code === 'ENOENT') return [];
        throw error;
      }
    }));
    const records = lists.flat().sort((left, right) => right.name.localeCompare(left.name)).slice(0, limit);
    const entries = await Promise.all(records.map(async ({ name, directory }) => {
      try {
        const value: unknown = JSON.parse(await readFile(join(directory, name), 'utf8'));
        return isHistoryEntry(value) ? value : undefined;
      } catch {
        return undefined;
      }
    }));
    return entries.filter((entry): entry is HistoryEntry => entry !== undefined);
  }
}
