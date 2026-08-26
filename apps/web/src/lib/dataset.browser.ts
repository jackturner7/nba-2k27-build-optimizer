import { buildDataset, crossCheckBadges, datasetCoverage, verificationReport } from '@2k27/core';
import type { RawDatasetFiles, SecondSource } from '@2k27/core';
import type { DatasetPayload } from './api';

// The dataset is fifteen JSON files and 272 KB. Importing them is what makes a
// serverless build possible: the engine's public entry has no node builtins, so
// once the data is in the bundle the whole optimizer runs in the browser.
//
// These are the same files the API reads from disk — one source of truth, not a
// copy. Vite inlines them at build time, so a data edit is a rebuild, and
// `npm run data:validate` still gates that build in CI.
import meta from '../../../../data/2k27/meta.json';
import attributes from '../../../../data/2k27/attributes.json';
import costCurves from '../../../../data/2k27/cost-curves.json';
import positions from '../../../../data/2k27/positions.json';
import body from '../../../../data/2k27/body.json';
import caps from '../../../../data/2k27/caps.json';
import budget from '../../../../data/2k27/budget.json';
import badges from '../../../../data/2k27/badges.json';
import animations from '../../../../data/2k27/animations.json';
import takeovers from '../../../../data/2k27/takeovers.json';
import capBreakers from '../../../../data/2k27/cap-breakers.json';
import badgeTokens from '../../../../data/2k27/badge-tokens.json';
import badgeBoosts from '../../../../data/2k27/badge-boosts.json';
import dependencies from '../../../../data/2k27/dependencies.json';
import archetypes from '../../../../data/2k27/archetypes.json';
import jpforthreee from '../../../../data/2k27/sources/jpforthreee-badge-requirements.json';

const raw = {
  meta,
  attributes,
  costCurves,
  positions,
  body,
  caps,
  budget,
  badges,
  animations,
  takeovers,
  capBreakers,
  badgeTokens,
  badgeBoosts,
  dependencies,
  archetypes,
} as unknown as RawDatasetFiles;

const secondSources = [jpforthreee] as unknown as SecondSource[];

let cached: DatasetPayload | null = null;

/**
 * The same payload the API's `GET /api/datasets/:id` returns, built locally.
 *
 * Cached because the reports are pure functions of immutable data — there is no
 * reload in a static build, since changing the data means rebuilding the bundle.
 */
export function loadDatasetPayload(): DatasetPayload {
  if (cached) return cached;
  const { dataset, issues } = buildDataset(raw);
  cached = {
    dataset,
    issues,
    verification: verificationReport(dataset),
    coverage: datasetCoverage(dataset),
    crossChecks: secondSources.map((source) => crossCheckBadges(dataset, source)),
  };
  return cached;
}
