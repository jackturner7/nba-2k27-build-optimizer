import type { Dataset } from '../types.js';
import { clauseOptions } from '../engine/requirements.js';
import {
  animationsSchema,
  archetypesSchema,
  attributesSchema,
  badgeBoostsSchema,
  badgeTokensSchema,
  badgesSchema,
  bodySchema,
  budgetSchema,
  capBreakersSchema,
  capsSchema,
  costCurvesSchema,
  dependenciesSchema,
  metaSchema,
  positionsSchema,
  takeoversSchema,
  type RawDatasetFiles,
} from './schema.js';

/** Recursively removes `$comment` / `$schema` documentation keys. */
function stripAnnotations<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripAnnotations) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith('$')) continue;
      out[k] = stripAnnotations(v);
    }
    return out as T;
  }
  return value;
}

export interface DataIssue {
  severity: 'error' | 'warning';
  file: string;
  message: string;
}

export interface LoadResult {
  dataset: Dataset;
  issues: DataIssue[];
}

/**
 * Validates and assembles the dataset from already-parsed JSON.
 *
 * Pure: takes plain objects, touches no filesystem. The browser gets the same
 * dataset over HTTP and runs the identical checks.
 */
export function buildDataset(input: RawDatasetFiles): LoadResult {
  const issues: DataIssue[] = [];

  // Documentation keys are legal anywhere in the dataset files — the whole point
  // is that a human edits these by hand — so strip them before validation
  // instead of forcing every schema to allow them.
  const raw = stripAnnotations(input) as RawDatasetFiles;

  const meta = metaSchema.parse(raw.meta);
  const attributes = attributesSchema.parse(raw.attributes);
  const costCurves = costCurvesSchema.parse(raw.costCurves);
  const positions = positionsSchema.parse(raw.positions);
  const body = bodySchema.parse(raw.body);
  const caps = capsSchema.parse(raw.caps);
  const budget = budgetSchema.parse(raw.budget);
  const badges = badgesSchema.parse(raw.badges);
  const animations = animationsSchema.parse(raw.animations);
  const takeovers = takeoversSchema.parse(raw.takeovers);
  const capBreakers = capBreakersSchema.parse(raw.capBreakers);
  const badgeTokens = badgeTokensSchema.parse(raw.badgeTokens);
  const badgeBoosts = badgeBoostsSchema.parse(raw.badgeBoosts);
  const dependencies = dependenciesSchema.parse(raw.dependencies);
  const archetypes = archetypesSchema.parse(raw.archetypes);

  const dataset: Dataset = {
    meta,
    ratingFloor: attributes.ratingFloor,
    ratingCeiling: attributes.ratingCeiling,
    categories: attributes.categories,
    attributes: attributes.attributes,
    priorityGroups: attributes.priorityGroups,
    costCurves: costCurves.curves,
    positions: positions.positions,
    body: body as Dataset['body'],
    caps: {
      capModel: caps.capModel,
      attributeCaps: caps.attributeCaps,
      overrides: caps.overrides.entries,
    },
    budget,
    badgeLevels: [...badges.levels].sort((a, b) => a.order - b.order),
    badgeGlobalRules: badges.globalRules,
    badges: badges.badges as Dataset['badges'],
    animationCategories: animations.categories,
    animations: animations.animations as Dataset['animations'],
    takeoverSlots: takeovers.slots,
    ...(takeovers.abilities ? { takeoverAbilities: takeovers.abilities } : {}),
    takeovers: takeovers.takeovers,
    capBreakers: capBreakers as Dataset['capBreakers'],
    badgeTokens: badgeTokens as Dataset['badgeTokens'],
    badgeBoosts,
    dependencies: dependencies.dependencies as Dataset['dependencies'],
    archetypes: archetypes.archetypes as Dataset['archetypes'],
    officialBuildNames: archetypes.officialBuildNames,
  };

  issues.push(...checkReferentialIntegrity(dataset));

  return { dataset, issues };
}

/**
 * Cross-file checks the per-file schemas cannot express: every attribute id a
 * badge/animation/archetype mentions must actually exist, cost curves must tile
 * the whole rating range, badge ladders must be monotonic, and so on.
 */
export function checkReferentialIntegrity(ds: Dataset): DataIssue[] {
  const issues: DataIssue[] = [];
  const attrIds = new Set(ds.attributes.map((a) => a.id));
  const curveIds = new Set(ds.costCurves.map((c) => c.id));
  const categoryIds = new Set(ds.categories.map((c) => c.id));
  const levelOrder = new Map(ds.badgeLevels.map((l) => [l.id, l.order]));
  const positionIds = new Set(ds.positions.map((p) => p.id));

  const err = (file: string, message: string) => issues.push({ severity: 'error', file, message });
  const warn = (file: string, message: string) => issues.push({ severity: 'warning', file, message });

  for (const a of ds.attributes) {
    if (!curveIds.has(a.costCurve)) err('attributes.json', `Attribute "${a.id}" references unknown cost curve "${a.costCurve}".`);
    if (!categoryIds.has(a.category)) err('attributes.json', `Attribute "${a.id}" references unknown category "${a.category}".`);
  }

  for (const g of ds.priorityGroups) {
    for (const id of [...g.attributes, ...g.supporting]) {
      if (!attrIds.has(id)) err('attributes.json', `Priority group "${g.id}" references unknown attribute "${id}".`);
    }
  }

  // Cost curves must cover every point from floor+1 to ceiling with no gap or overlap.
  for (const curve of ds.costCurves) {
    const sorted = [...curve.ranges].sort((a, b) => a.from - b.from);
    let expected = ds.ratingFloor + 1;
    for (const r of sorted) {
      if (r.from !== expected) {
        err('cost-curves.json', `Curve "${curve.id}" has a gap or overlap at rating ${expected} (next range starts at ${r.from}).`);
        break;
      }
      if (r.to < r.from) err('cost-curves.json', `Curve "${curve.id}" has an inverted range ${r.from}-${r.to}.`);
      expected = r.to + 1;
    }
    if (expected !== ds.ratingCeiling + 1) {
      err('cost-curves.json', `Curve "${curve.id}" stops at ${expected - 1} but the rating ceiling is ${ds.ratingCeiling}.`);
    }
  }

  const capAttrs = new Set(ds.caps.attributeCaps.map((c) => c.attribute));
  for (const a of ds.attributes) {
    if (!capAttrs.has(a.id)) err('caps.json', `No cap rule for attribute "${a.id}".`);
  }
  for (const c of ds.caps.attributeCaps) {
    if (!attrIds.has(c.attribute)) err('caps.json', `Cap rule references unknown attribute "${c.attribute}".`);
    if (c.hardMin > c.hardMax) err('caps.json', `Cap rule for "${c.attribute}" has hardMin above hardMax.`);
  }

  for (const badge of ds.badges) {
    if (badge.tiers.length === 0) warn('badges.json', `Badge "${badge.id}" has no tiers and can never unlock.`);
    let prevOrder = 0;
    const seenLevels = new Set<string>();
    for (const tier of badge.tiers) {
      const order = levelOrder.get(tier.level);
      if (order === undefined) {
        err('badges.json', `Badge "${badge.id}" references unknown level "${tier.level}".`);
        continue;
      }
      if (seenLevels.has(tier.level)) err('badges.json', `Badge "${badge.id}" defines level "${tier.level}" twice.`);
      seenLevels.add(tier.level);
      if (order <= prevOrder) err('badges.json', `Badge "${badge.id}" lists levels out of order at "${tier.level}".`);
      prevOrder = order;
      for (const req of tier.requires.flatMap(clauseOptions)) {
        if (!attrIds.has(req.attribute)) err('badges.json', `Badge "${badge.id}" requires unknown attribute "${req.attribute}".`);
        if (req.min < ds.ratingFloor || req.min > ds.ratingCeiling) {
          err('badges.json', `Badge "${badge.id}" level "${tier.level}" requires ${req.attribute} ${req.min}, outside ${ds.ratingFloor}-${ds.ratingCeiling}.`);
        }
      }
      if (tier.tokenCost === null && !badge.incompleteTiers) {
        warn('badges.json', `Badge "${badge.id}" tier "${tier.level}" has no token cost, so it can never be equipped. Set incompleteTiers if that is expected.`);
      }
    }
    // A higher tier asking for LESS than a lower one is a data-quality signal,
    // not a structural break — the engine walks ladders bottom-up regardless, so
    // this is reported as a warning rather than failing the whole dataset.
    for (let i = 1; i < badge.tiers.length; i++) {
      const lower = badge.tiers[i - 1]!;
      const higher = badge.tiers[i]!;
      const lowerMins = new Map<string, number>();
      for (const r of lower.requires.flatMap(clauseOptions)) {
        lowerMins.set(r.attribute, Math.max(lowerMins.get(r.attribute) ?? 0, r.min));
      }
      for (const req of higher.requires.flatMap(clauseOptions)) {
        const lowerMin = lowerMins.get(req.attribute);
        if (lowerMin !== undefined && lowerMin > req.min) {
          warn('badges.json', `Badge "${badge.id}": ${req.attribute} requirement DROPS from ${lowerMin} (${lower.level}) to ${req.min} (${higher.level}). Check this row against the source.`);
        }
      }
      if (lower.tokenCost !== null && higher.tokenCost !== null && higher.tokenCost < lower.tokenCost) {
        warn('badges.json', `Badge "${badge.id}": token cost DROPS from ${lower.tokenCost} (${lower.level}) to ${higher.tokenCost} (${higher.level}).`);
      }
    }
    if (badge.restrictions?.positions) {
      for (const p of badge.restrictions.positions) {
        if (!positionIds.has(p)) err('badges.json', `Badge "${badge.id}" restricts to unknown position "${p}".`);
      }
    }
  }

  const animCategoryIds = new Set(ds.animationCategories.map((c) => c.id));
  for (const anim of ds.animations) {
    if (!animCategoryIds.has(anim.category)) err('animations.json', `Animation "${anim.id}" references unknown category "${anim.category}".`);
    for (const req of anim.requires.flatMap(clauseOptions)) {
      if (!attrIds.has(req.attribute)) err('animations.json', `Animation "${anim.id}" requires unknown attribute "${req.attribute}".`);
    }
  }

  for (const t of ds.takeovers) {
    for (const tier of t.tiers) {
      for (const req of tier.requires.flatMap(clauseOptions)) {
        if (!attrIds.has(req.attribute)) err('takeovers.json', `Takeover "${t.id}" tier "${tier.id}" requires unknown attribute "${req.attribute}".`);
      }
    }
  }

  for (const dep of ds.dependencies) {
    if (!attrIds.has(dep.source)) err('dependencies.json', `Dependency "${dep.id}" references unknown source "${dep.source}".`);
    if (!attrIds.has(dep.target)) err('dependencies.json', `Dependency "${dep.id}" references unknown target "${dep.target}".`);
    if (dep.kind === 'diminishing' && (dep.threshold === undefined || dep.factor === undefined)) {
      err('dependencies.json', `Dependency "${dep.id}" is 'diminishing' but is missing threshold or factor.`);
    }
    if (dep.kind === 'soft-link' && dep.ratio === undefined) {
      err('dependencies.json', `Dependency "${dep.id}" is 'soft-link' but is missing ratio.`);
    }
  }

  const groupIds = new Set(ds.priorityGroups.map((g) => g.id));
  for (const arch of ds.archetypes) {
    if (!positionIds.has(arch.position)) err('archetypes.json', `Archetype "${arch.id}" uses unknown position "${arch.position}".`);
    for (const g of Object.keys(arch.priorities)) {
      if (!groupIds.has(g)) err('archetypes.json', `Archetype "${arch.id}" prioritizes unknown group "${g}".`);
    }
    for (const a of [...Object.keys(arch.constraints.minimums), ...Object.keys(arch.constraints.softTargets)]) {
      if (!attrIds.has(a)) err('archetypes.json', `Archetype "${arch.id}" constrains unknown attribute "${a}".`);
    }
  }

  for (const id of ds.capBreakers.eligibility.excludedAttributes) {
    if (!attrIds.has(id)) err('cap-breakers.json', `Excluded attribute "${id}" does not exist.`);
  }
  for (const id of ds.capBreakers.includedAttributes) {
    if (!attrIds.has(id)) err('cap-breakers.json', `Included attribute "${id}" does not exist.`);
  }

  // Cap overrides and cap breaker tables are both transcribed by eye off the
  // NBA 2K HQ builder, so they get checked against each other. `newCap` is the
  // redundancy that makes a mis-read row loud instead of silent.
  for (const [key, entry] of Object.entries(ds.caps.overrides)) {
    if (key.split('|').length !== 4) {
      err('caps.json', `Cap override key "${key}" must be POSITION|height|weight|wingspan.`);
    }
    for (const id of [...Object.keys(entry.caps), ...Object.keys(entry.capFloors)]) {
      if (!attrIds.has(id)) err('caps.json', `Cap override "${key}" sets unknown attribute "${id}".`);
    }
    for (const [id, floor] of Object.entries(entry.capFloors)) {
      const exact = entry.caps[id];
      if (exact !== undefined) {
        err('caps.json', `Cap override "${key}" gives "${id}" both an exact cap (${exact}) and a floor (${floor}); it can only be one.`);
      }
    }
    const covered = new Set([...Object.keys(entry.caps), ...Object.keys(entry.capFloors)]);
    const missing = [...attrIds].filter((id) => !covered.has(id));
    if (missing.length) {
      warn('caps.json', `Cap override "${key}" says nothing about ${missing.length} attribute(s) (${missing.join(', ')}); they fall back to the modelled cap.`);
    }
  }

  // The gain tables and the derived caps come from the same screenshots, so they
  // get checked against each other. These are the guards that would have caught
  // the misreading corrected in 0.7.0.
  for (const [key, table] of Object.entries(ds.capBreakers.gainTables.entries)) {
    if (table.body.split('|').length !== 4) {
      err('cap-breakers.json', `Gain table "${key}" has body "${table.body}"; expected POSITION|height|weight|wingspan.`);
    }
    const entry = ds.caps.overrides[table.body];
    if (!entry) {
      warn('cap-breakers.json', `Gain table "${key}" has no cap entry for body "${table.body}" in caps.json, so its ceilings cannot be cross-checked.`);
    }
    for (const [id, row] of Object.entries(table.attributes)) {
      if (!attrIds.has(id)) {
        err('cap-breakers.json', `Gain table "${key}" has a row for unknown attribute "${id}".`);
        continue;
      }
      if (row.slots.length !== ds.capBreakers.slotsPerAttribute) {
        err('cap-breakers.json', `Gain table "${key}" row "${id}" has ${row.slots.length} slots; expected ${ds.capBreakers.slotsPerAttribute}.`);
      }
      // A gain after a locked slot cannot be claimed, so it is almost certainly
      // a transcription slip rather than a real hole in the middle of a row.
      const firstLock = row.slots.indexOf(null);
      if (firstLock >= 0 && row.slots.slice(firstLock).some((s) => s !== null)) {
        err('cap-breakers.json', `Gain table "${key}" row "${id}" has an unlocked slot after a locked one; slots fill in order, so that gain is unreachable.`);
      }

      const sampled = table.sampledAt[id];
      if (sampled === undefined) {
        err('cap-breakers.json', `Gain table "${key}" row "${id}" has no sampledAt rating, so its gains have no origin.`);
        continue;
      }
      const total = row.slots.reduce<number>((a, s) => a + (s ?? 0), 0);
      if (sampled + total !== row.newCap) {
        err(
          'cap-breakers.json',
          `Gain table "${key}" row "${id}" does not add up: sampled at ${sampled} + slots (${total}) = ${sampled + total}, but newCap says ${row.newCap}. One of the two was mis-transcribed.`
        );
      }

      // A ladder that ends in a lock has reached the frame's ceiling, which is
      // exactly how the caps in caps.json were derived. They must agree.
      const locked = row.slots.some((s) => s === null);
      const derived = entry?.caps[id];
      if (locked && entry && derived !== row.newCap) {
        err(
          'cap-breakers.json',
          `Gain table "${key}" row "${id}" locks at ${row.newCap}, so that is the cap for ${table.body} — but caps.json ${derived === undefined ? 'does not record it as an exact cap' : `says ${derived}`}.`
        );
      }
      if (!locked && entry && entry.capFloors[id] !== row.newCap) {
        err(
          'cap-breakers.json',
          `Gain table "${key}" row "${id}" never locks, so ${row.newCap} is only a floor for ${table.body} — but caps.json ${entry.capFloors[id] === undefined ? 'does not record it as a floor' : `says ${entry.capFloors[id]}`}.`
        );
      }
    }
  }

  // Badge token economy
  const categoryIdSet = new Set(ds.categories.map((c) => c.id));
  for (const d of ds.badgeTokens.disciplines) {
    if (!categoryIdSet.has(d)) {
      err('badge-tokens.json', `Discipline "${d}" is not an attribute category. Badge disciplines and attribute categories must line up for token earning to work.`);
    }
    if (ds.badgeTokens.slots.byDiscipline[d] === undefined) {
      warn('badge-tokens.json', `No badge slot count for discipline "${d}"; it will be treated as zero slots.`);
    }
  }
  for (const badge of ds.badges) {
    if (!ds.badgeTokens.disciplines.includes(badge.category)) {
      warn('badge-tokens.json', `Badge "${badge.id}" is in category "${badge.category}", which is not a token discipline, so it can never be equipped.`);
    }
  }
  const slotSum = Object.values(ds.badgeTokens.slots.byDiscipline).reduce((a, b) => a + b, 0);
  if (slotSum !== ds.badgeTokens.slots.total) {
    warn('badge-tokens.json', `Badge slots per discipline sum to ${slotSum} but total is ${ds.badgeTokens.slots.total}.`);
  }

  const badgeIds = new Set(ds.badges.map((b) => b.id));
  for (const id of ds.badgeBoosts.rules.excludedBadges) {
    if (!badgeIds.has(id)) err('badge-boosts.json', `Excluded badge "${id}" does not exist.`);
  }
  if (!levelOrder.has(ds.badgeBoosts.rules.minimumLevelToBoost)) {
    err('badge-boosts.json', `minimumLevelToBoost "${ds.badgeBoosts.rules.minimumLevelToBoost}" is not a known badge level.`);
  }

  return issues;
}

/** Summarises how much of the dataset is still placeholder data. */
export interface VerificationReport {
  totalRecords: number;
  byStatus: Record<string, number>;
  unverifiedShare: number;
  byFile: { file: string; total: number; unverified: number }[];
}

export function verificationReport(ds: Dataset): VerificationReport {
  const byStatus: Record<string, number> = {};
  const byFile: { file: string; total: number; unverified: number }[] = [];

  const tally = (file: string, records: { verification?: { status?: string } }[]) => {
    let unverified = 0;
    for (const r of records) {
      const status = r.verification?.status ?? 'unverified';
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (status === 'unverified' || status === 'estimated') unverified++;
    }
    byFile.push({ file, total: records.length, unverified });
  };

  tally('attributes.json', ds.attributes);
  tally('cost-curves.json', ds.costCurves);
  tally('positions.json', ds.positions);
  tally('body.json', [
    { verification: ds.body.weightModel.verification },
    { verification: ds.body.wingspanModel.verification },
    { verification: ds.body.interactions.verification },
  ]);
  tally('caps.json', [{ verification: ds.caps.capModel.verification }, ...ds.caps.attributeCaps]);
  tally('budget.json', [{ verification: ds.budget.verification }]);
  tally('badges.json', ds.badges);
  tally('animations.json', ds.animations);
  tally('takeovers.json', ds.takeovers);
  tally('cap-breakers.json', [{ verification: ds.capBreakers.verification }]);
  tally('badge-boosts.json', [{ verification: ds.badgeBoosts.verification }]);
  tally('dependencies.json', ds.dependencies);
  tally('archetypes.json', ds.archetypes);

  const totalRecords = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const unverifiedCount = (byStatus['unverified'] ?? 0) + (byStatus['estimated'] ?? 0);

  return {
    totalRecords,
    byStatus,
    unverifiedShare: totalRecords === 0 ? 0 : unverifiedCount / totalRecords,
    byFile,
  };
}
