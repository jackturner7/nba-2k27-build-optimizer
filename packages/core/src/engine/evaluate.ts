import type { AttributeVector, BuildEvaluation, BuildBody, Dataset, ScoreWeights } from '../types.js';
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
  }
): number {
  const cost = costModelFor(ds);
  const badges = evaluateBadges(ds, attributes, body);
  const animations = evaluateAnimations(ds, attributes, body);
  const takeovers = evaluateTakeoversLight(ds, attributes);
  return scoreBuild({
    ds,
    body,
    attributes,
    badges,
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

  const badgeBoostPlan =
    options.useBadgeBoosts === false ? [] : planBadgeBoosts(ds, effective, body, priorities);

  // Reflect the boost plan back onto the badge list so the UI can show the
  // level a player would actually be playing with.
  const boostByBadge = new Map(badgeBoostPlan.map((b) => [b.badgeId, b]));
  for (const b of badges) {
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
