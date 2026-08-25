import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, type LoadResult } from './loader.js';
import type { RawDatasetFiles } from './schema.js';

const FILE_MAP: Record<keyof RawDatasetFiles, string> = {
  meta: 'meta.json',
  attributes: 'attributes.json',
  costCurves: 'cost-curves.json',
  positions: 'positions.json',
  body: 'body.json',
  caps: 'caps.json',
  budget: 'budget.json',
  badges: 'badges.json',
  animations: 'animations.json',
  takeovers: 'takeovers.json',
  capBreakers: 'cap-breakers.json',
  badgeTokens: 'badge-tokens.json',
  badgeBoosts: 'badge-boosts.json',
  dependencies: 'dependencies.json',
  archetypes: 'archetypes.json',
};

/**
 * Walks up from this module looking for the repo's /data directory, so the API
 * works whether it runs from source (tsx), from dist, or from a different cwd.
 */
export function findDataRoot(startDir?: string): string {
  if (process.env['DATA_ROOT']) return resolve(process.env['DATA_ROOT']);
  let dir = startDir ?? fileURLToPath(new URL('.', import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'data');
    if (existsSync(join(candidate, '2k27', 'meta.json'))) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate the /data directory. Set DATA_ROOT to an absolute path containing <datasetId>/meta.json.'
  );
}

export function loadDatasetFromDisk(datasetId = '2k27', dataRoot?: string): LoadResult {
  const root = dataRoot ?? findDataRoot();
  const dir = join(root, datasetId);
  const raw = {} as RawDatasetFiles;
  for (const [key, filename] of Object.entries(FILE_MAP) as [keyof RawDatasetFiles, string][]) {
    const path = join(dir, filename);
    if (!existsSync(path)) throw new Error(`Dataset "${datasetId}" is missing ${filename} (looked in ${dir}).`);
    try {
      raw[key] = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new Error(`Failed to parse ${filename}: ${(e as Error).message}`);
    }
  }
  return buildDataset(raw);
}

/** Lists the dataset ids available on disk, so multiple game years can coexist. */
export function listDatasets(dataRoot?: string): string[] {
  const root = dataRoot ?? findDataRoot();
  return readdirSync(root).filter((name) => {
    try {
      return statSync(join(root, name)).isDirectory() && existsSync(join(root, name, 'meta.json'));
    } catch {
      return false;
    }
  });
}
