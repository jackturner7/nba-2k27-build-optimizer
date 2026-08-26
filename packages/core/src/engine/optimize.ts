import type {
  AttributeVector,
  BuildBody,
  Dataset,
  OptimizeRequest,
  OptimizeResult,
  OptimizedBuild,
  RequirementClause,
  ScoreWeights,
} from '../types.js';
import { collectBreakpoints, type BreakpointMap } from './breakpoints.js';
import { validateBody, formatHeight } from './body.js';
import { computeBudget, computeCaps } from './caps.js';
import { costModelFor, type CostModel } from './cost.js';
import { evaluateBuild, quickScore } from './evaluate.js';
import { clauseOptions, reachable } from './requirements.js';
import { DEFAULT_SCORE_WEIGHTS, priorityWeights, resolveWeights } from './score.js';
import { levelWeight } from './unlocks.js';

/** How much of a multi-attribute requirement's value to credit before the whole thing is satisfied. */
const PARTIAL_CREDIT = 0.35;
/** Weight of the "more rating is mildly good" term that operates between thresholds. */
const LINEAR_TERM = 26;
/** Baseline value of rating in attributes nobody asked for, so builds stay playable. */
const BASELINE_TERM = 4;

interface GainEvent {
  threshold: number;
  gain: number;
  label: string;
}

interface Commitment {
  id: string;
  label: string;
  kind: 'badge' | 'animation' | 'takeover';
  requires: RequirementClause[];
  value: number;
}

interface SearchProfile {
  id: string;
  label: string;
  weights: ScoreWeights;
}

export function optimize(ds: Dataset, request: OptimizeRequest): OptimizeResult {
  const started = Date.now();
  const cost = costModelFor(ds);
  const validation = validateBody(ds, request.body);
  const body = validation.corrected;
  const caps = computeCaps(ds, body);
  const budget = computeBudget(ds, body);
  const weights = resolveWeights(request);
  const priorities = request.priorities ?? {};
  const pw = priorityWeights(ds, priorities);
  const resultCount = Math.max(1, Math.min(6, request.resultCount ?? 3));

  const infeasibilityReasons: string[] = [...validation.errors];

  // --- Hard minimums --------------------------------------------------------
  const floors: AttributeVector = {};
  for (const a of ds.attributes) floors[a.id] = ds.ratingFloor;
  for (const [attr, min] of Object.entries(request.minimums ?? {})) {
    if (min === undefined) continue;
    const cap = caps[attr];
    if (cap === undefined) {
      infeasibilityReasons.push(`Unknown attribute "${attr}" in the requested minimums.`);
      continue;
    }
    if (min > cap) {
      infeasibilityReasons.push(
        `${nameOf(ds, attr)} ${min} is impossible on a ${body.position} at ${formatHeight(body.heightInches)} / ${body.weightPounds} lb / ${formatHeight(body.wingspanInches)} wingspan — the cap is ${cap}. Shorten the build, lighten it, or lower the requirement.`
      );
      floors[attr] = cap;
    } else {
      floors[attr] = Math.max(floors[attr]!, Math.round(min));
    }
  }

  const floorCost = cost.totalCost(floors);
  if (Number.isFinite(budget) && floorCost > budget) {
    infeasibilityReasons.push(
      `The requested minimums cost ${floorCost} build points but this body only has ${budget}. Drop about ${floorCost - budget} points of requirements.`
    );
  }

  const breakpoints = collectBreakpoints(ds, body, caps, request);

  if (infeasibilityReasons.length > 0) {
    // Still return the best legal attempt so the user sees how close they are.
    const fallback = greedyFallback(ds, cost, caps, floors, budget, breakpoints, pw);
    const evaluated = finalize(ds, body, fallback, request, weights, breakpoints, 'best-effort', 'Closest legal build');
    return {
      request,
      feasible: false,
      infeasibilityReasons,
      builds: [evaluated],
      comparison: [],
      datasetWarning: ds.meta.uiWarnings.globalBanner,
      computeMs: Date.now() - started,
    };
  }

  // --- Candidate levels -----------------------------------------------------
  const levels: Record<string, number[]> = {};
  for (const a of ds.attributes) {
    const cap = Math.min(caps[a.id] ?? ds.ratingFloor, request.maximums?.[a.id] ?? ds.ratingCeiling);
    const floor = floors[a.id]!;
    const set = new Set<number>([floor]);
    for (const bp of breakpoints[a.id] ?? []) {
      if (bp.value >= floor && bp.value <= cap) set.add(bp.value);
    }
    if (cap > floor) set.add(cap);
    levels[a.id] = [...set].sort((x, y) => x - y);
  }

  const commitments = collectCommitments(ds, caps, floors, request, pw);

  // --- Search ---------------------------------------------------------------
  const floorSets = buildFloorSets(ds, cost, caps, floors, budget, commitments, levels);
  const profiles = searchProfiles(weights);

  const seen = new Set<string>();
  const candidates: { attrs: AttributeVector; profile: SearchProfile; floorSetLabel: string }[] = [];

  // Every floor set gets the balanced profile; the alternative weightings only
  // run on the most promising few, which keeps the search under a second.
  for (const [index, fs] of floorSets.entries()) {
    const active = index < 5 ? profiles : profiles.slice(0, 1);
    for (const profile of active) {
      const gains = buildGainEvents(ds, fs.floors, pw, profile.weights, request);
      const solved = solveKnapsack(ds, cost, levels, fs.floors, budget, gains, pw);
      if (!solved) continue;
      const polished = polish(ds, cost, caps, fs.floors, budget, breakpoints, solved, request, weights, pw);
      const key = signature(ds, polished);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ attrs: polished, profile, floorSetLabel: fs.label });
    }
  }

  if (candidates.length === 0) {
    const fallback = greedyFallback(ds, cost, caps, floors, budget, breakpoints, pw);
    candidates.push({ attrs: fallback, profile: profiles[0]!, floorSetLabel: 'Greedy fallback' });
  }

  const scored = candidates
    .map((c) => ({
      c,
      build: finalize(ds, body, c.attrs, request, weights, breakpoints, c.profile.id, labelFor(c.profile, c.floorSetLabel)),
    }))
    .sort((a, b) => b.build.score.total - a.build.score.total);

  const chosen = pickDiverse(scored.map((s) => s.build), resultCount);
  dedupeLabels(chosen);
  annotateTradeoffs(ds, chosen);

  return {
    request,
    feasible: true,
    infeasibilityReasons: [],
    builds: chosen,
    comparison: compareBuilds(ds, chosen),
    datasetWarning: ds.meta.uiWarnings.globalBanner,
    computeMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Value model used by the search
// ---------------------------------------------------------------------------

/**
 * Turns the dataset's threshold structure into a per-attribute list of
 * "crossing this rating is worth this much" events, given a set of floors.
 *
 * Floors matter: a badge needing 3PT 85 and Ball Handle 78 is a single-attribute
 * decision once the floors already guarantee the Ball Handle, and the search
 * should value it fully rather than at partial credit.
 */
function buildGainEvents(
  ds: Dataset,
  floors: AttributeVector,
  pw: Record<string, number>,
  weights: ScoreWeights,
  request: OptimizeRequest
): Record<string, GainEvent[]> {
  const events: Record<string, GainEvent[]> = {};
  for (const a of ds.attributes) events[a.id] = [];

  const focusOf = (ids: string[]) =>
    ids.length ? ids.reduce((acc, id) => acc + (pw[id] ?? 0), 0) / ids.length : 0;

  const push = (attr: string, threshold: number, gain: number, label: string) => {
    const list = events[attr];
    if (!list || gain <= 0) return;
    list.push({ threshold, gain, label });
  };

  const creditRequirement = (
    requires: RequirementClause[],
    fullGain: number,
    label: string
  ) => {
    const clauseMet = (clause: RequirementClause) =>
      clauseOptions(clause).some((o) => (floors[o.attribute] ?? 0) >= o.min);

    for (const clause of requires) {
      const others = requires.filter((c) => c !== clause);
      const othersMetByFloors = others.every(clauseMet);
      const options = clauseOptions(clause);
      // Within an "any of" clause only one branch has to be bought, so each
      // branch gets the full clause value — they are alternatives, not a set.
      const share = othersMetByFloors ? 1 : PARTIAL_CREDIT / Math.max(1, requires.length - 1);
      for (const option of options) {
        push(option.attribute, option.min, fullGain * share, label);
      }
    }
  };

  for (const badge of ds.badges) {
    const ids = [...new Set(badge.tiers.flatMap((t) => t.requires.flatMap(clauseOptions).map((r) => r.attribute)))];
    const focus = focusOf(ids);
    let prevWeight = 0;
    for (const tier of badge.tiers) {
      const w = levelWeight(ds, tier.level);
      // A tier with no known token cost can never be equipped, so chasing its
      // attribute threshold buys nothing. Weight it down rather than out — the
      // threshold may still be shared with something the build does want.
      const affordable = tier.tokenCost === null ? 0.15 : 1;
      const gain = (w - prevWeight) * badge.impact * (0.35 + 1.65 * focus) * weights.badgeValue * affordable;
      prevWeight = w;
      creditRequirement(tier.requires, gain, `${badge.name} ${tier.level}`);
    }
  }

  for (const anim of ds.animations) {
    const ids = [...new Set(anim.requires.flatMap(clauseOptions).map((r) => r.attribute))];
    const gain = anim.impact * 1.4 * (0.35 + 1.65 * focusOf(ids)) * weights.animationUnlocks;
    creditRequirement(anim.requires, gain, anim.name);
  }

  for (const t of ds.takeovers) {
    const ids = [...new Set(t.tiers.flatMap((x) => x.requires.flatMap(clauseOptions).map((r) => r.attribute)))];
    const focus = focusOf(ids);
    for (const tier of t.tiers) {
      const gain = t.impact * 1.6 * (0.35 + 1.65 * focus) * weights.animationUnlocks;
      creditRequirement(tier.requires, gain, `${t.name} — ${tier.name}`);
    }
  }

  for (const [attr, target] of Object.entries(request.softTargets ?? {})) {
    if (target === undefined) continue;
    push(attr, Math.round(target), 6 + 10 * (pw[attr] ?? 0), `Requested target ${target}`);
  }

  for (const list of Object.values(events)) list.sort((a, b) => a.threshold - b.threshold);
  return events;
}

function valueAt(
  ds: Dataset,
  attr: string,
  value: number,
  events: GainEvent[],
  pw: Record<string, number>
): number {
  let total = 0;
  for (const e of events) {
    if (e.threshold > value) break;
    total += e.gain;
  }
  const span = ds.ratingCeiling - ds.ratingFloor;
  const normalized = span > 0 ? (value - ds.ratingFloor) / span : 0;
  total += normalized * ((pw[attr] ?? 0) * LINEAR_TERM + BASELINE_TERM);
  return total;
}

// ---------------------------------------------------------------------------
// Multiple-choice knapsack
// ---------------------------------------------------------------------------

/**
 * Exact optimum for the separable surrogate: each attribute picks one candidate
 * level, total cost stays inside the budget. Because candidate levels are only
 * the threshold ratings, the state space stays small enough to solve exactly
 * rather than greedily — which is what stops the classic "spent 40 points to go
 * from 89 to 92 for nothing" mistake.
 */
function solveKnapsack(
  ds: Dataset,
  cost: CostModel,
  levels: Record<string, number[]>,
  floors: AttributeVector,
  budget: number,
  events: Record<string, GainEvent[]>,
  pw: Record<string, number>
): AttributeVector | null {
  const attrs = ds.attributes.map((a) => a.id);
  const baseCost = cost.totalCost(floors);
  if (Number.isFinite(budget) && baseCost > budget) return null;

  // No budget model: every attribute just takes its best-value level.
  if (!Number.isFinite(budget)) {
    const out: AttributeVector = { ...floors };
    for (const id of attrs) {
      const opts = (levels[id] ?? []).filter((v) => v >= (floors[id] ?? 0));
      let best = floors[id]!;
      let bestValue = -Infinity;
      for (const v of opts) {
        const val = valueAt(ds, id, v, events[id] ?? [], pw);
        if (val > bestValue) {
          bestValue = val;
          best = v;
        }
      }
      out[id] = best;
    }
    return out;
  }

  const remaining = Math.floor(budget - baseCost);
  const width = remaining + 1;

  let dp = new Float64Array(width).fill(-Infinity);
  dp[0] = 0;
  const choices: Uint8Array[] = [];

  for (const id of attrs) {
    const floor = floors[id]!;
    const options = (levels[id] ?? [floor])
      .filter((v) => v >= floor)
      .map((v) => ({ value: v, extraCost: cost.cost(id, floor, v) }))
      .filter((o) => o.extraCost <= remaining)
      .slice(0, 24);
    if (options.length === 0) options.push({ value: floor, extraCost: 0 });

    const baseValue = valueAt(ds, id, floor, events[id] ?? [], pw);
    const optionValues = options.map((o) => valueAt(ds, id, o.value, events[id] ?? [], pw) - baseValue);

    const next = new Float64Array(width).fill(-Infinity);
    const choice = new Uint8Array(width);

    for (let j = 0; j < width; j++) {
      const current = dp[j]!;
      if (current === -Infinity) continue;
      for (let k = 0; k < options.length; k++) {
        const c = options[k]!.extraCost;
        const target = j + c;
        if (target >= width) continue;
        const value = current + optionValues[k]!;
        if (value > next[target]!) {
          next[target] = value;
          choice[target] = k;
        }
      }
    }
    dp = next;
    choices.push(choice);
    // Stash the option list alongside for backtracking.
    optionCache.set(choice, options.map((o) => o.value));
  }

  let bestJ = 0;
  let bestValue = -Infinity;
  for (let j = 0; j < width; j++) {
    if (dp[j]! > bestValue) {
      bestValue = dp[j]!;
      bestJ = j;
    }
  }
  if (bestValue === -Infinity) return null;

  const out: AttributeVector = { ...floors };
  let j = bestJ;
  for (let i = attrs.length - 1; i >= 0; i--) {
    const id = attrs[i]!;
    const choice = choices[i]!;
    const options = optionCache.get(choice)!;
    const k = choice[j]!;
    const value = options[k] ?? floors[id]!;
    out[id] = value;
    j -= cost.cost(id, floors[id]!, value);
    if (j < 0) j = 0;
  }
  return out;
}

const optionCache = new WeakMap<Uint8Array, number[]>();

// ---------------------------------------------------------------------------
// Commitments and floor sets
// ---------------------------------------------------------------------------

function collectCommitments(
  ds: Dataset,
  caps: AttributeVector,
  floors: AttributeVector,
  request: OptimizeRequest,
  pw: Record<string, number>
): Commitment[] {
  const out: Commitment[] = [];
  const focusOf = (ids: string[]) => (ids.length ? ids.reduce((a, id) => a + (pw[id] ?? 0), 0) / ids.length : 0);

  const withinMax = (reqs: RequirementClause[]) =>
    reqs.every((clause) =>
      clauseOptions(clause).some((o) => (request.maximums?.[o.attribute] ?? ds.ratingCeiling) >= o.min)
    );

  const alreadyMet = (reqs: RequirementClause[]) =>
    reqs.every((clause) => clauseOptions(clause).some((o) => (floors[o.attribute] ?? 0) >= o.min));

  /**
   * How many attributes this requirement genuinely forces. An "any of" clause
   * counts as one because the player picks a branch — only a set of separate
   * clauses is a true conjunction worth forcing as a commitment.
   */
  const clauseCount = (reqs: RequirementClause[]) => reqs.length;

  for (const badge of ds.badges) {
    let prev = 0;
    for (const tier of badge.tiers) {
      const w = levelWeight(ds, tier.level);
      const gain = (w - prev) * badge.impact;
      prev = w;
      const ids = [...new Set(tier.requires.flatMap(clauseOptions).map((r) => r.attribute))];
      if (clauseCount(tier.requires) < 2) continue;
      if (!reachable(tier.requires, caps) || !withinMax(tier.requires) || alreadyMet(tier.requires)) continue;
      out.push({
        id: `badge:${badge.id}:${tier.level}`,
        label: `${badge.name} (${ds.badgeLevels.find((l) => l.id === tier.level)?.name ?? tier.level})`,
        kind: 'badge',
        requires: tier.requires,
        value: gain * (0.35 + 1.65 * focusOf(ids)),
      });
    }
  }

  for (const anim of ds.animations) {
    const ids = [...new Set(anim.requires.flatMap(clauseOptions).map((r) => r.attribute))];
    if (ids.length < 2) continue;
    if (!reachable(anim.requires, caps) || !withinMax(anim.requires) || alreadyMet(anim.requires)) continue;
    out.push({
      id: `animation:${anim.id}`,
      label: anim.name,
      kind: 'animation',
      requires: anim.requires,
      value: anim.impact * 1.4 * (0.35 + 1.65 * focusOf(ids)),
    });
  }

  for (const t of ds.takeovers) {
    for (const tier of t.tiers) {
      const ids = [...new Set(tier.requires.flatMap(clauseOptions).map((r) => r.attribute))];
      if (clauseCount(tier.requires) < 2) continue;
      if (!reachable(tier.requires, caps) || !withinMax(tier.requires) || alreadyMet(tier.requires)) continue;
      out.push({
        id: `takeover:${t.id}:${tier.id}`,
        label: `${t.name} — ${tier.name}`,
        kind: 'takeover',
        requires: tier.requires,
        value: t.impact * 1.8 * (0.35 + 1.65 * focusOf(ids)),
      });
    }
  }

  return out.sort((a, b) => b.value - a.value).slice(0, 40);
}

interface FloorSet {
  label: string;
  floors: AttributeVector;
}

function buildFloorSets(
  ds: Dataset,
  cost: CostModel,
  caps: AttributeVector,
  base: AttributeVector,
  budget: number,
  commitments: Commitment[],
  levels: Record<string, number[]>
): FloorSet[] {
  const sets: FloorSet[] = [{ label: 'No forced combos', floors: { ...base } }];
  const budgetLimit = Number.isFinite(budget) ? budget : Number.POSITIVE_INFINITY;

  const apply = (floors: AttributeVector, c: Commitment): AttributeVector | null => {
    const next = { ...floors };
    for (const clause of c.requires) {
      const options = clauseOptions(clause);
      // For a choice, commit to the branch that is cheapest from where we are.
      let best: { attribute: string; min: number; price: number } | null = null;
      for (const o of options) {
        const cap = caps[o.attribute];
        if (cap === undefined || o.min > cap) continue;
        const from = next[o.attribute] ?? ds.ratingFloor;
        if (from >= o.min) {
          best = { attribute: o.attribute, min: o.min, price: -1 };
          break;
        }
        const price = cost.cost(o.attribute, from, o.min);
        if (!best || price < best.price) best = { attribute: o.attribute, min: o.min, price };
      }
      if (!best) return null;
      next[best.attribute] = Math.max(next[best.attribute] ?? 0, best.min);
    }
    // Leave headroom: a floor set that eats the whole budget leaves the
    // knapsack nothing to optimize with.
    if (cost.totalCost(next) > budgetLimit * 0.92) return null;
    return next;
  };

  // Each strong combo on its own.
  for (const c of commitments.slice(0, 12)) {
    const floors = apply(base, c);
    if (floors) sets.push({ label: `Forcing ${c.label}`, floors });
  }

  // A greedy chain that stacks the best value-per-point combos together.
  let chain = { ...base };
  const chainLabels: string[] = [];
  for (let depth = 0; depth < 5; depth++) {
    let best: { c: Commitment; floors: AttributeVector; density: number } | null = null;
    const currentCost = cost.totalCost(chain);
    for (const c of commitments) {
      if (chainLabels.includes(c.label)) continue;
      const floors = apply(chain, c);
      if (!floors) continue;
      const delta = cost.totalCost(floors) - currentCost;
      if (delta <= 0) continue;
      const density = c.value / delta;
      if (!best || density > best.density) best = { c, floors, density };
    }
    if (!best) break;
    chain = best.floors;
    chainLabels.push(best.c.label);
    sets.push({ label: `Stacking ${chainLabels.join(' + ')}`, floors: { ...chain } });
  }

  // Deduplicate identical floor vectors.
  const seen = new Set<string>();
  return sets
    .filter((s) => {
      const key = ds.attributes.map((a) => s.floors[a.id]).join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 14)
    .filter((s) => Object.keys(levels).length > 0);
}

function searchProfiles(base: ScoreWeights): SearchProfile[] {
  return [
    { id: 'balanced', label: 'Balanced', weights: base },
    {
      id: 'badges',
      label: 'Badge-maximising',
      weights: { ...base, badgeValue: base.badgeValue * 1.6, animationUnlocks: base.animationUnlocks * 1.3 },
    },
    {
      id: 'efficient',
      label: 'Point-efficient',
      weights: {
        ...base,
        wastedPoints: base.wastedPoints * 2.2,
        attributeEfficiency: base.attributeEfficiency * 2.0,
      },
    },
    {
      id: 'ratings',
      label: 'Rating-forward',
      weights: {
        ...base,
        shooting: base.shooting * 1.5,
        finishing: base.finishing * 1.5,
        playmaking: base.playmaking * 1.5,
        defensiveVersatility: base.defensiveVersatility * 1.5,
        physicals: base.physicals * 1.4,
        badgeValue: base.badgeValue * 0.8,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

/**
 * Trim-and-refill. The knapsack works on a surrogate; this pass measures the
 * real score, pulls back any rating sitting above the last threshold it paid
 * for, and re-spends what it recovers on the cheapest thresholds that actually
 * improve the build.
 */
function polish(
  ds: Dataset,
  cost: CostModel,
  caps: AttributeVector,
  floors: AttributeVector,
  budget: number,
  breakpoints: BreakpointMap,
  start: AttributeVector,
  request: OptimizeRequest,
  weights: ScoreWeights,
  _pw: Record<string, number>
): AttributeVector {
  let current = { ...start };
  const ctx = {
    caps,
    budget,
    breakpoints,
    priorities: request.priorities ?? {},
    weights,
    tokenOverrides: request.tokenOverrides,
  };
  const cache = new Map<string, number>();
  const scoreOf = (attrs: AttributeVector): number => {
    const key = signature(ds, attrs);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = quickScore(ds, request.body, attrs, ctx);
    cache.set(key, value);
    return value;
  };
  let bestScore = scoreOf(current);

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;

    // 1. Trim anything above its last useful breakpoint.
    for (const a of ds.attributes) {
      const value = current[a.id]!;
      const floor = floors[a.id]!;
      const bps = breakpoints[a.id] ?? [];
      let target = floor;
      for (const bp of bps) {
        if (bp.value > value) break;
        if (bp.value >= floor && bp.sources.some((s) => s.kind !== 'cap' && s.kind !== 'floor')) target = bp.value;
      }
      if (target >= value) continue;
      const probe = { ...current, [a.id]: target };
      const probeScore = scoreOf(probe);
      if (probeScore >= bestScore - 1e-9) {
        current = probe;
        bestScore = probeScore;
        changed = true;
      }
    }

    // 2. Spend whatever is left on the cheapest threshold that improves things.
    for (let i = 0; i < 16; i++) {
      const spent = cost.totalCost(current);
      const left = Number.isFinite(budget) ? budget - spent : Number.POSITIVE_INFINITY;
      if (left <= 0) break;

      let best: { attr: string; value: number; score: number } | null = null;
      for (const a of ds.attributes) {
        const value = current[a.id]!;
        const cap = Math.min(caps[a.id] ?? ds.ratingFloor, request.maximums?.[a.id] ?? ds.ratingCeiling);
        const next = (breakpoints[a.id] ?? []).find((bp) => bp.value > value && bp.value <= cap);
        if (!next) continue;
        const delta = cost.cost(a.id, value, next.value);
        if (delta > left) continue;
        const probe = { ...current, [a.id]: next.value };
        const score = scoreOf(probe);
        if (score > bestScore + 1e-9 && (!best || score > best.score)) {
          best = { attr: a.id, value: next.value, score };
        }
      }
      if (!best) break;
      current[best.attr] = best.value;
      bestScore = best.score;
      changed = true;
    }

    if (!changed) break;
  }

  return current;
}

/** Fills a build greedily when the search cannot run — used for infeasible requests. */
function greedyFallback(
  ds: Dataset,
  cost: CostModel,
  caps: AttributeVector,
  floors: AttributeVector,
  budget: number,
  breakpoints: BreakpointMap,
  pw: Record<string, number>
): AttributeVector {
  const out: AttributeVector = { ...floors };
  for (const a of ds.attributes) {
    out[a.id] = Math.min(out[a.id] ?? ds.ratingFloor, caps[a.id] ?? ds.ratingFloor);
  }
  if (!Number.isFinite(budget)) return out;

  for (let i = 0; i < 200; i++) {
    const left = budget - cost.totalCost(out);
    if (left <= 0) break;
    let best: { attr: string; value: number; density: number } | null = null;
    for (const a of ds.attributes) {
      const value = out[a.id]!;
      const next = (breakpoints[a.id] ?? []).find((bp) => bp.value > value);
      if (!next) continue;
      const delta = cost.cost(a.id, value, next.value);
      if (delta > left || delta <= 0) continue;
      const weight = next.sources.reduce((acc, s) => acc + s.weight, 0) + (pw[a.id] ?? 0) * 5;
      const density = weight / delta;
      if (!best || density > best.density) best = { attr: a.id, value: next.value, density };
    }
    if (!best) break;
    out[best.attr] = best.value;
  }
  return out;
}

function finalize(
  ds: Dataset,
  body: BuildBody,
  attrs: AttributeVector,
  request: OptimizeRequest,
  weights: ScoreWeights,
  breakpoints: BreakpointMap,
  id: string,
  label: string
): OptimizedBuild {
  const evaluation = evaluateBuild(ds, body, attrs, {
    priorities: request.priorities,
    weights,
    minimums: request.minimums,
    softTargets: request.softTargets,
    maximums: request.maximums,
    breakpoints,
    useCapBreakers: request.useCapBreakers !== false,
    useBadgeBoosts: request.useBadgeBoosts !== false,
    tokenOverrides: request.tokenOverrides,
  });

  return {
    ...evaluation,
    id,
    label,
    tradeoffs: [],
    rationale: buildRationale(ds, evaluation.attributes, breakpoints, costModelFor(ds), evaluation.caps),
  };
}

/**
 * Explains, per attribute, why the optimizer stopped where it did. This is the
 * part users actually argue with, so it names the specific unlock and the price
 * of the next one.
 */
function buildRationale(
  ds: Dataset,
  attrs: AttributeVector,
  breakpoints: BreakpointMap,
  cost: CostModel,
  caps: AttributeVector
): OptimizedBuild['rationale'] {
  const out: OptimizedBuild['rationale'] = [];
  for (const a of ds.attributes) {
    const value = attrs[a.id]!;
    if (value <= ds.ratingFloor) continue;
    const bps = breakpoints[a.id] ?? [];
    const at = bps.find((b) => b.value === value);
    const next = bps.find((b) => b.value > value && b.sources.some((s) => s.kind !== 'cap' && s.kind !== 'floor'));
    const cap = caps[a.id] ?? ds.ratingCeiling;

    const holding = at?.sources.filter((s) => s.kind !== 'floor' && s.kind !== 'cap').map((s) => s.label) ?? [];
    let reason: string;
    if (holding.length > 0) {
      reason = `${value} is the threshold for ${holding.slice(0, 3).join(', ')}${holding.length > 3 ? ` and ${holding.length - 3} more` : ''}.`;
    } else if (value >= cap) {
      reason = `${value} is the cap for this body.`;
    } else {
      reason = `${value} carries no threshold of its own; it is here to feed the categories you prioritised.`;
    }
    if (next) {
      reason += ` The next unlock is ${next.sources[0]?.label ?? 'a threshold'} at ${next.value}, which costs ${cost.cost(a.id, value, next.value)} more build points.`;
    } else {
      reason += ` Nothing above ${value} unlocks anything in this dataset.`;
    }
    out.push({ attribute: a.id, attributeName: a.name, value, reason });
  }
  return out.sort((x, y) => y.value - x.value);
}

// ---------------------------------------------------------------------------
// Diversity and comparison
// ---------------------------------------------------------------------------

function signature(ds: Dataset, attrs: AttributeVector): string {
  return ds.attributes.map((a) => attrs[a.id]).join(',');
}

function distance(ds: Dataset, a: OptimizedBuild, b: OptimizedBuild): number {
  let d = 0;
  for (const attr of ds.attributes) {
    d += Math.abs((a.attributes[attr.id] ?? 0) - (b.attributes[attr.id] ?? 0));
  }
  return d;
}

/** Keeps the best build, then only adds builds that are actually different. */
function pickDiverse(builds: OptimizedBuild[], count: number): OptimizedBuild[] {
  const chosen: OptimizedBuild[] = [];
  for (const b of builds) {
    if (chosen.length >= count) break;
    if (chosen.length === 0) {
      chosen.push(b);
      continue;
    }
    const tooSimilar = chosen.some((c) => distanceLite(c, b) < 8);
    if (!tooSimilar) chosen.push(b);
  }
  // If everything collapsed to one shape, pad with the next best regardless.
  for (const b of builds) {
    if (chosen.length >= count) break;
    if (!chosen.includes(b)) chosen.push(b);
  }
  return chosen;
}

function distanceLite(a: OptimizedBuild, b: OptimizedBuild): number {
  let d = 0;
  for (const key of Object.keys(a.attributes)) {
    d += Math.abs((a.attributes[key] ?? 0) - (b.attributes[key] ?? 0));
  }
  return d;
}

/**
 * Two search paths can converge on the same label with different builds behind
 * it. Rename the collisions after the attribute that actually separates them,
 * so the tabs in the UI mean something.
 */
function dedupeLabels(builds: OptimizedBuild[]): void {
  const counts = new Map<string, number>();
  for (const b of builds) counts.set(b.label, (counts.get(b.label) ?? 0) + 1);

  const seen = new Map<string, number>();
  for (const b of builds) {
    if ((counts.get(b.label) ?? 0) < 2) continue;
    const n = (seen.get(b.label) ?? 0) + 1;
    seen.set(b.label, n);
    const reference = builds.find((other) => other !== b && other.label === b.label);
    const distinguishing = reference
      ? Object.keys(b.attributes)
          .map((id) => ({ id, delta: (b.attributes[id] ?? 0) - (reference.attributes[id] ?? 0) }))
          .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))[0]
      : undefined;
    if (distinguishing && distinguishing.delta !== 0) {
      const name = b.rationale.find((r) => r.attribute === distinguishing.id)?.attributeName ?? distinguishing.id;
      b.label = `${b.label} · ${distinguishing.delta > 0 ? 'more' : 'less'} ${name}`;
    } else {
      b.label = `${b.label} · variant ${n}`;
    }
  }
}

function annotateTradeoffs(ds: Dataset, builds: OptimizedBuild[]): void {
  if (builds.length < 2) {
    if (builds[0]) builds[0].tradeoffs = ['Only one build survived the constraints, so there is nothing to trade against.'];
    return;
  }
  const best = builds[0]!;
  for (let i = 0; i < builds.length; i++) {
    const b = builds[i]!;
    const notes: string[] = [];
    if (i === 0) {
      notes.push('Highest total score under your weightings.');
    }
    const reference = i === 0 ? builds[1]! : best;
    const label = i === 0 ? 'the runner-up' : 'the top build';

    const diffs = ds.attributes
      .map((a) => ({
        name: a.name,
        delta: (b.attributes[a.id] ?? 0) - (reference.attributes[a.id] ?? 0),
      }))
      .filter((d) => Math.abs(d.delta) >= 3)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, 4);

    for (const d of diffs) {
      notes.push(`${d.delta > 0 ? '+' : ''}${d.delta} ${d.name} vs ${label}.`);
    }

    const badgeDelta = b.badges.length - reference.badges.length;
    if (badgeDelta !== 0) notes.push(`${badgeDelta > 0 ? 'Holds' : 'Gives up'} ${Math.abs(badgeDelta)} badge${Math.abs(badgeDelta) === 1 ? '' : 's'} compared with ${label}.`);

    const wasteDelta = b.waste.reduce((a, w) => a + w.refundableBuildPoints, 0);
    if (wasteDelta > 0) notes.push(`Carries ${wasteDelta} build points above the last useful threshold.`);
    else notes.push('No build points sit above a useful threshold.');

    if (b.remaining > 0 && Number.isFinite(b.remaining)) notes.push(`${b.remaining} build points left unspent.`);

    b.tradeoffs = notes;
  }
}

function compareBuilds(ds: Dataset, builds: OptimizedBuild[]): string[] {
  if (builds.length < 2) return [];
  const out: string[] = [];
  const keys: (keyof OptimizedBuild['score']['components'])[] = [
    'badgeValue',
    'animationUnlocks',
    'defensiveVersatility',
    'shooting',
    'finishing',
    'playmaking',
    'physicals',
    'attributeEfficiency',
  ];
  const pretty: Record<string, string> = {
    badgeValue: 'badge value',
    animationUnlocks: 'animation unlocks',
    defensiveVersatility: 'defensive versatility',
    shooting: 'shooting',
    finishing: 'finishing',
    playmaking: 'playmaking',
    physicals: 'physicals',
    attributeEfficiency: 'point efficiency',
  };

  for (const key of keys) {
    const ranked = [...builds].sort((a, b) => b.score.components[key] - a.score.components[key]);
    const top = ranked[0]!;
    const bottom = ranked[ranked.length - 1]!;
    const spread = top.score.components[key] - bottom.score.components[key];
    if (spread < 4) continue;
    out.push(`${top.label} leads on ${pretty[key]} (${top.score.components[key].toFixed(0)} vs ${bottom.score.components[key].toFixed(0)}).`);
  }

  const cheapest = [...builds].sort((a, b) => a.spent - b.spent)[0]!;
  if (builds.some((b) => b.spent !== cheapest.spent)) {
    out.push(`${cheapest.label} spends the fewest build points (${cheapest.spent}).`);
  }
  return out;
}

function labelFor(profile: SearchProfile, floorSetLabel: string): string {
  if (floorSetLabel === 'No forced combos') return profile.label;
  return `${profile.label} — ${floorSetLabel}`;
}

function nameOf(ds: Dataset, id: string): string {
  return ds.attributes.find((a) => a.id === id)?.name ?? id;
}

export { DEFAULT_SCORE_WEIGHTS, distance };
