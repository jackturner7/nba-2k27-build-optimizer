import type {
  AttributeVector,
  BuildBody,
  Dataset,
  OptimizeRequest,
  ScoreBreakdown,
  ScoreWeights,
  UnlockedAnimation,
  UnlockedBadge,
  TakeoverStatus,
} from '../types.js';
import type { BreakpointMap } from './breakpoints.js';
import { lastUsefulBreakpoint } from './breakpoints.js';
import type { CostModel } from './cost.js';
import { levelWeight } from './unlocks.js';

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  badgeValue: 1.0,
  animationUnlocks: 0.7,
  attributeEfficiency: 0.35,
  defensiveVersatility: 0.4,
  shooting: 0.4,
  finishing: 0.4,
  playmaking: 0.4,
  physicals: 0.3,
  wastedPoints: 0.5,
};

/**
 * Per-attribute priority weight in 0..1, derived from the user's priority
 * sliders. An attribute a priority group names directly gets the full weight;
 * a supporting attribute gets a fraction, so the optimizer will buy the Vertical
 * that makes Driving Dunk work without treating it as a goal in itself.
 */
export function priorityWeights(ds: Dataset, priorities: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of ds.attributes) out[a.id] = 0;

  for (const group of ds.priorityGroups) {
    const raw = priorities[group.id];
    if (raw === undefined) continue;
    const w = Math.max(0, Math.min(100, raw)) / 100;
    for (const id of group.attributes) out[id] = Math.max(out[id] ?? 0, w);
    for (const id of group.supporting) out[id] = Math.max(out[id] ?? 0, w * 0.4);
  }
  return out;
}

const SUPPORT_FACTOR = 0.4;

/**
 * Applies declared attribute dependencies to produce the ratings the score
 * should actually believe. A 95 Speed With Ball on a 60 Ball Handle build does
 * not play like a 95, and the optimizer should not pay for it as if it does.
 */
export function effectiveAttributes(ds: Dataset, attrs: AttributeVector): AttributeVector {
  const out = { ...attrs };
  for (const dep of ds.dependencies) {
    if (!dep.enabled) continue;
    const source = attrs[dep.source] ?? 0;
    const target = out[dep.target];
    if (target === undefined) continue;

    if (dep.kind === 'soft-link') {
      const ceiling = source * (dep.ratio ?? 1) + (dep.offset ?? 0);
      out[dep.target] = Math.min(target, ceiling);
    } else if (dep.kind === 'diminishing') {
      const threshold = dep.threshold ?? ds.ratingCeiling;
      const sourceMin = dep.sourceMin ?? 0;
      if (target > threshold && source < sourceMin) {
        out[dep.target] = threshold + (target - threshold) * (dep.factor ?? 1);
      }
    }
  }
  return out;
}

export function dependencyWarnings(
  ds: Dataset,
  attrs: AttributeVector
): { ruleId: string; message: string; severity: 'info' | 'warning' | 'critical' }[] {
  const warnings: { ruleId: string; message: string; severity: 'info' | 'warning' | 'critical' }[] = [];
  const nameOf = (id: string) => ds.attributes.find((a) => a.id === id)?.name ?? id;

  for (const dep of ds.dependencies) {
    if (!dep.enabled) continue;
    const source = attrs[dep.source] ?? 0;
    const target = attrs[dep.target] ?? 0;

    if (dep.kind === 'soft-link') {
      const ceiling = source * (dep.ratio ?? 1) + (dep.offset ?? 0);
      if (target > ceiling + 1) {
        warnings.push({
          ruleId: dep.id,
          severity: 'warning',
          message: `${nameOf(dep.target)} ${target} is running ahead of ${nameOf(dep.source)} ${source}. Past roughly ${Math.round(ceiling)} the extra points do little.`,
        });
      }
    } else if (dep.kind === 'diminishing') {
      const threshold = dep.threshold ?? ds.ratingCeiling;
      const sourceMin = dep.sourceMin ?? 0;
      if (target > threshold && source < sourceMin) {
        warnings.push({
          ruleId: dep.id,
          severity: 'warning',
          message: `${nameOf(dep.target)} ${target} is above ${threshold} but ${nameOf(dep.source)} is only ${source} (wants ${sourceMin}+). Value above the threshold is discounted.`,
        });
      }
    } else if (dep.kind === 'hard-min') {
      const min = dep.min ?? (dep.ratio !== undefined ? source * dep.ratio : 0);
      if (target < min) {
        warnings.push({
          ruleId: dep.id,
          severity: 'critical',
          message: `${nameOf(dep.target)} must be at least ${Math.round(min)} (currently ${target}).`,
        });
      }
    }
  }
  return warnings;
}

/**
 * Per-badge / per-animation attribute lists, precomputed once per dataset.
 * The optimizer scores tens of thousands of candidate vectors, and a linear
 * `.find` over the badge list inside that loop dominated the runtime.
 */
interface DefIndex {
  badgeAttrs: Map<string, string[]>;
  animAttrs: Map<string, string[]>;
}

const defIndexCache = new WeakMap<Dataset, DefIndex>();

export function defIndex(ds: Dataset): DefIndex {
  let idx = defIndexCache.get(ds);
  if (!idx) {
    idx = {
      badgeAttrs: new Map(
        ds.badges.map((b) => [b.id, [...new Set(b.tiers.flatMap((t) => t.requires.map((r) => r.attribute)))]])
      ),
      animAttrs: new Map(ds.animations.map((a) => [a.id, [...new Set(a.requires.map((r) => r.attribute))]])),
    };
    defIndexCache.set(ds, idx);
  }
  return idx;
}

function norm(ds: Dataset, v: number): number {
  const span = ds.ratingCeiling - ds.ratingFloor;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (v - ds.ratingFloor) / span));
}

function weightedRating(ds: Dataset, attrs: AttributeVector, spec: Record<string, number>): number {
  let sum = 0;
  let weight = 0;
  for (const [id, w] of Object.entries(spec)) {
    const v = attrs[id];
    if (v === undefined) continue;
    sum += norm(ds, v) * w;
    weight += w;
  }
  return weight === 0 ? 0 : (sum / weight) * 100;
}

/**
 * Breadth-rewarding aggregate. Uses a sub-linear power mean so a build that is
 * decent at five defensive jobs scores above one that is elite at one and
 * useless at the rest — which is what "versatility" is supposed to mean.
 */
function versatility(ds: Dataset, attrs: AttributeVector, ids: string[]): number {
  const values = ids.map((id) => norm(ds, attrs[id] ?? ds.ratingFloor));
  if (values.length === 0) return 0;
  const p = 0.5;
  const mean = values.reduce((acc, v) => acc + Math.pow(v, p), 0) / values.length;
  return Math.pow(mean, 1 / p) * 100;
}

const CATEGORY_SPECS = {
  shooting: { three_point: 0.55, mid_range: 0.3, free_throw: 0.15 },
  finishing: { driving_dunk: 0.3, driving_layup: 0.25, close_shot: 0.2, standing_dunk: 0.15, post_control: 0.1 },
  playmaking: { pass_accuracy: 0.4, ball_handle: 0.35, speed_with_ball: 0.25 },
  physicals: { speed: 0.3, acceleration: 0.3, vertical: 0.2, strength: 0.15, stamina: 0.05 },
} as const;

const DEFENSIVE_IDS = ['perimeter_defense', 'interior_defense', 'steal', 'block', 'defensive_rebound'];

export interface ScoreInputs {
  ds: Dataset;
  body: BuildBody;
  attributes: AttributeVector;
  badges: UnlockedBadge[];
  animations: UnlockedAnimation[];
  takeovers: TakeoverStatus[];
  breakpoints: BreakpointMap;
  cost: CostModel;
  budget: number;
  spent: number;
  priorities: Record<string, number>;
  weights: ScoreWeights;
}

export function scoreBuild(input: ScoreInputs): ScoreBreakdown {
  const { ds, attributes, badges, animations, takeovers, breakpoints, cost, spent, weights } = input;
  const pw = priorityWeights(ds, input.priorities);
  const eff = effectiveAttributes(ds, attributes);

  // --- 1. Badge value -------------------------------------------------------
  // A badge counts for more when it sits on an attribute the user prioritized.
  const idx = defIndex(ds);
  let badgeRaw = 0;
  for (const b of badges) {
    const uniqueAttrs = idx.badgeAttrs.get(b.badgeId) ?? [];
    const focus = uniqueAttrs.length
      ? uniqueAttrs.reduce((acc, id) => acc + (pw[id] ?? 0), 0) / uniqueAttrs.length
      : 0;
    badgeRaw += levelWeight(ds, b.level) * b.impact * (0.35 + 1.65 * focus);
  }
  const badgeValue = scale(badgeRaw, 220);

  // --- 2. Animation unlocks -------------------------------------------------
  // Only the best unlock in each category counts fully; the rest are flavour.
  const bestByCategory = new Map<string, number>();
  let animRaw = 0;
  for (const a of animations) {
    const reqAttrs = idx.animAttrs.get(a.animationId) ?? [];
    const focus = reqAttrs.length ? reqAttrs.reduce((acc, id) => acc + (pw[id] ?? 0), 0) / reqAttrs.length : 0;
    const value = a.impact * (0.35 + 1.65 * focus);
    const prev = bestByCategory.get(a.category) ?? 0;
    if (value > prev) {
      animRaw += value - prev;
      bestByCategory.set(a.category, value);
    } else {
      animRaw += value * 0.15;
    }
  }
  for (const t of takeovers) {
    if (t.unlockedTierIds.length > 0) animRaw += t.impact * 0.8 * t.unlockedTierIds.length;
  }
  const animationUnlocks = scale(animRaw, 70);

  // --- 3 & 9. Efficiency and waste -----------------------------------------
  let usefulSpend = 0;
  let wastedSpend = 0;
  for (const a of ds.attributes) {
    const v = attributes[a.id];
    if (v === undefined) continue;
    const bps = breakpoints[a.id] ?? [];
    const useful = lastUsefulBreakpoint(bps, v);
    usefulSpend += cost.cost(a.id, ds.ratingFloor, Math.min(v, useful));
    if (v > useful) wastedSpend += cost.cost(a.id, useful, v);
  }
  const attributeEfficiency = spent <= 0 ? 100 : (usefulSpend / spent) * 100;
  const wastedPoints = input.budget > 0 && Number.isFinite(input.budget) ? -(wastedSpend / input.budget) * 100 : -wastedSpend / 10;

  // --- 4-8. Category strength ----------------------------------------------
  const defensiveVersatility = versatility(ds, eff, DEFENSIVE_IDS);
  const shooting = weightedRating(ds, eff, CATEGORY_SPECS.shooting);
  const finishing = weightedRating(ds, eff, CATEGORY_SPECS.finishing);
  const playmaking = weightedRating(ds, eff, CATEGORY_SPECS.playmaking);
  const physicals = weightedRating(ds, eff, CATEGORY_SPECS.physicals);

  const components = {
    badgeValue,
    animationUnlocks,
    attributeEfficiency,
    defensiveVersatility,
    shooting,
    finishing,
    playmaking,
    physicals,
    wastedPoints,
  };

  // Category components are scaled by how much the user asked for them, so a
  // Stretch Big is not penalised for having no Ball Handle.
  const focusScale = {
    defensiveVersatility: groupFocus(ds, pw, DEFENSIVE_IDS),
    shooting: groupFocus(ds, pw, Object.keys(CATEGORY_SPECS.shooting)),
    finishing: groupFocus(ds, pw, Object.keys(CATEGORY_SPECS.finishing)),
    playmaking: groupFocus(ds, pw, Object.keys(CATEGORY_SPECS.playmaking)),
    physicals: groupFocus(ds, pw, Object.keys(CATEGORY_SPECS.physicals)),
  };

  const weighted = {
    badgeValue: components.badgeValue * weights.badgeValue,
    animationUnlocks: components.animationUnlocks * weights.animationUnlocks,
    attributeEfficiency: components.attributeEfficiency * weights.attributeEfficiency,
    defensiveVersatility: components.defensiveVersatility * weights.defensiveVersatility * focusScale.defensiveVersatility,
    shooting: components.shooting * weights.shooting * focusScale.shooting,
    finishing: components.finishing * weights.finishing * focusScale.finishing,
    playmaking: components.playmaking * weights.playmaking * focusScale.playmaking,
    physicals: components.physicals * weights.physicals * focusScale.physicals,
    wastedPoints: components.wastedPoints * weights.wastedPoints,
  };

  const total = Object.values(weighted).reduce((a, b) => a + b, 0);

  return { total: round2(total), components: mapRound(components), weighted: mapRound(weighted) };
}

function groupFocus(_ds: Dataset, pw: Record<string, number>, ids: string[]): number {
  if (ids.length === 0) return 0;
  const max = ids.reduce((acc, id) => Math.max(acc, pw[id] ?? 0), 0);
  const mean = ids.reduce((acc, id) => acc + (pw[id] ?? 0), 0) / ids.length;
  // A floor of 0.15 keeps a completely un-prioritised category from being free
  // to tank, which would let the optimizer produce unplayable builds.
  return 0.15 + 0.85 * (0.6 * max + 0.4 * mean);
}

function scale(raw: number, reference: number): number {
  return (raw / reference) * 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapRound<T extends Record<string, number>>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj)) (out as Record<string, number>)[k] = round2(v);
  return out;
}

export function resolveWeights(request: OptimizeRequest): ScoreWeights {
  return { ...DEFAULT_SCORE_WEIGHTS, ...(request.scoreWeights ?? {}) };
}

export { SUPPORT_FACTOR };
