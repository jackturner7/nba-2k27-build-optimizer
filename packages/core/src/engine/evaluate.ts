import type { AttributeVector, BuildEvaluation, BuildBody, Dataset, ScoreWeights } from '../types.js';
import { computeTokens, planBadgeLoadout, planBadgeLoadoutFast } from './tokens.js';
import { defIndex, priorityWeights } from './score.js';
import { collectBreakpoints, type BreakpointMap } from './breakpoints.js';
import { computeBudget, computeCaps } from './caps.js';
import { costModelFor } from './cost.js';
import { findWaste, planBadgeBoosts, planCapBreakers } from './plans.js';
import { DEFAULT_SCORE_WEIGHTS, dependencyWarnings, effectiveAttributes, scoreBuild } from './score.js';
import {
  evaluateAnimations,
  evaluateBadges,
  evaluateTakeovers,
  evaluateTakeoversLight,
  nextAnimationThresholds,
  nextBadgeThresholds,
} from './unlocks.js';

/**
 * Score-only evaluation for the optimizer's inner loop.
 *
 * Uses the same scoring function as {@link evaluateBuild} — the numbers agree —
 * but skips everything that only exists for the report: next-threshold pricing,
 * waste messages, dependency warnings, cap breaker and boost planning.
 */
export function quickScore(
  ds: Dataset,
  body: BuildBody,
  attributes: AttributeVector,
  ctx: {
    caps: AttributeVector;
    budget: number;
    breakpoints: BreakpointMap;
    priorities: Record<string, number>;
    weights: ScoreWeights;
    tokenOverrides?: Record<string, number | null>;
  }
): number {
  const cost = costModelFor(ds);
  const badges = evaluateBadges(ds, attributes, body);
  const animations = evaluateAnimations(ds, attributes, body);
  const takeovers = evaluateTakeoversLight(ds, attributes);

  // Badge value has to be measured on what the build can AFFORD to equip, not
  // on what it is merely eligible for. The exact loadout solver is too slow for
  // this loop, so a greedy value-per-token pass stands in; `evaluateBuild`
  // reports the exact one.
  const pw = priorityWeights(ds, ctx.priorities);
  const tokens = computeTokens(ds, attributes, ctx.tokenOverrides);
  const equipped = planBadgeLoadoutFast(ds, attributes, body, tokens, pw, defIndex(ds).badgeAttrs);

  return scoreBuild({
    ds,
    body,
    attributes,
    badges,
    equippedBadges: equipped,
    animations,
    takeovers,
    breakpoints: ctx.breakpoints,
    cost,
    budget: ctx.budget,
    spent: cost.totalCost(attributes),
    priorities: ctx.priorities,
    weights: ctx.weights,
  }).total;
}

export interface EvaluateOptions {
  priorities?: Record<string, number>;
  weights?: Partial<ScoreWeights>;
  minimums?: Partial<Record<string, number>>;
  softTargets?: Partial<Record<string, number>>;
  maximums?: Partial<Record<string, number>>;
  useCapBreakers?: boolean;
  useBadgeBoosts?: boolean;
  breakpoints?: BreakpointMap;
  /** Per-discipline badge token pool overrides, for real in-game numbers. */
  tokenOverrides?: Record<string, number | null>;
}

/**
 * Full report for one concrete build. The UI calls this on every slider change,
 * so it does no searching — just measurement.
 */
export function evaluateBuild(
  ds: Dataset,
  body: BuildBody,
  attributes: AttributeVector,
  options: EvaluateOptions = {}
): BuildEvaluation {
  const cost = costModelFor(ds);
  const caps = computeCaps(ds, body);
  const budget = computeBudget(ds, body);
  const priorities = options.priorities ?? {};
  const weights: ScoreWeights = { ...DEFAULT_SCORE_WEIGHTS, ...(options.weights ?? {}) };

  const clamped: AttributeVector = {};
  for (const a of ds.attributes) {
    const cap = caps[a.id] ?? ds.ratingFloor;
    const raw = attributes[a.id] ?? ds.ratingFloor;
    clamped[a.id] = Math.max(ds.ratingFloor, Math.min(cap, Math.round(raw)));
  }

  const breakpoints =
    options.breakpoints ??
    collectBreakpoints(ds, body, caps, {
      minimums: options.minimums,
      softTargets: options.softTargets,
      maximums: options.maximums,
    });

  const spent = cost.totalCost(clamped);
  const remaining = Number.isFinite(budget) ? budget - spent : Number.POSITIVE_INFINITY;

  const capBreaker =
    options.useCapBreakers === false
      ? { plan: [], remaining: 0, effective: clamped }
      : planCapBreakers(ds, clamped, body, caps, priorities);

  const effective = capBreaker.effective;

  const badges = evaluateBadges(ds, effective, body);
  const animations = evaluateAnimations(ds, effective, body);
  const takeovers = evaluateTakeovers(ds, effective, caps, cost);

  // Attributes decide eligibility; badge tokens and slots decide what is
  // actually equipped. Cap breakers deliberately feed eligibility here but not
  // the token pool — 2K27 does not grant tokens for applying a cap breaker.
  const tokenPool = computeTokens(ds, clamped, options.tokenOverrides);
  const loadout = planBadgeLoadout(ds, effective, body, tokenPool, priorityWeights(ds, priorities), badges);

  const badgeBoostPlan =
    options.useBadgeBoosts === false ? [] : planBadgeBoosts(ds, effective, body, priorities);

  // Reflect the boost plan back onto both badge lists so the UI can show the
  // level a player would actually be playing with.
  const boostByBadge = new Map(badgeBoostPlan.map((b) => [b.badgeId, b]));
  for (const b of [...badges, ...loadout.equipped]) {
    const boost = boostByBadge.get(b.badgeId);
    if (boost) {
      b.boostedLevel = boost.toLevel;
      b.boostedLevelName = boost.toLevelName;
    }
  }

  const score = scoreBuild({
    ds,
    body,
    attributes: clamped,
    badges,
    equippedBadges: loadout.equipped,
    animations,
    takeovers,
    breakpoints,
    cost,
    budget,
    spent,
    priorities,
    weights,
  });

  return {
    body,
    attributes: clamped,
    effectiveAttributes: effective,
    caps,
    budget,
    spent,
    remaining,
    badges,
    equippedBadges: loadout.equipped,
    tokens: loadout.report,
    nextBadges: nextBadgeThresholds(ds, effective, body, caps, cost),
    animations,
    nextAnimations: nextAnimationThresholds(ds, effective, body, caps, cost),
    takeovers,
    capBreakerPlan: capBreaker.plan,
    capBreakersRemaining: capBreaker.remaining,
    badgeBoostPlan,
    waste: findWaste(ds, clamped, breakpoints, cost),
    dependencyWarnings: dependencyWarnings(ds, clamped),
    score,
  };
}

export { effectiveAttributes };
