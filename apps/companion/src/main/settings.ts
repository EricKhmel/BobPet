import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type StoredSettings, migrateSettings } from '@bob-pet/shared';
import { migrateSettingsFile } from './settings-migration.js';
export class SettingsStore {
  private readonly file = join(app.getPath('userData'), 'settings.json');
  /** Where settings lived before the app was given a name. See settings-migration.ts. */
  private readonly legacyFile = join(app.getPath('appData'), '@bob-pet', 'companion', 'settings.json');
  migrate(): Promise<boolean> { return migrateSettingsFile(this.file, this.legacyFile); }
  async read(): Promise<StoredSettings> { try { return migrateSettings(JSON.parse(await readFile(this.file, 'utf8'))); } catch { return migrateSettings(undefined); } }
  async write(value: StoredSettings): Promise<void> { await mkdir(app.getPath('userData'), { recursive: true }); const temporary = `${this.file}.tmp`; await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, this.file); }
}
