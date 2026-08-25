import type {
  AttributeVector,
  BadgeBoostRecommendation,
  BuildBody,
  CapBreakerPlanStatus,
  CapBreakerRecommendation,
  Dataset,
  WasteFinding,
} from '../types.js';
import type { BreakpointMap } from './breakpoints.js';
import { lastUsefulBreakpoint } from './breakpoints.js';
import { capBreakerGain, capBreakerTableFor, isCapBreakerEligible, usableSlots } from './caps.js';
import type { CostModel } from './cost.js';
import { clauseOptions } from './requirements.js';
import { priorityWeights } from './score.js';
import { evaluateAnimations, evaluateBadges, evaluateTakeovers, levelName, levelWeight } from './unlocks.js';

/**
 * Scalar "how much did this build actually unlock" value. Used to compare
 * hypothetical single-point changes (cap breakers) without running the full
 * score, which depends on budget and waste terms that a cap breaker does not
 * touch.
 */
export function unlockValue(
  ds: Dataset,
  attrs: AttributeVector,
  body: BuildBody,
  pw: Record<string, number>
): number {
  let total = 0;

  for (const b of evaluateBadges(ds, attrs, body)) {
    const def = ds.badges.find((x) => x.id === b.badgeId);
    const ids = [...new Set(def?.tiers.flatMap((t) => t.requires.flatMap(clauseOptions).map((r) => r.attribute)) ?? [])];
    const focus = ids.length ? ids.reduce((a, id) => a + (pw[id] ?? 0), 0) / ids.length : 0;
    total += levelWeight(ds, b.level) * b.impact * (0.35 + 1.65 * focus);
  }

  const bestByCategory = new Map<string, number>();
  for (const a of evaluateAnimations(ds, attrs, body)) {
    const def = ds.animations.find((x) => x.id === a.animationId);
    const ids = [...new Set(def?.requires.flatMap(clauseOptions).map((r) => r.attribute) ?? [])];
    const focus = ids.length ? ids.reduce((acc, id) => acc + (pw[id] ?? 0), 0) / ids.length : 0;
    const value = a.impact * (0.35 + 1.65 * focus) * 1.4;
    const prev = bestByCategory.get(a.category) ?? 0;
    if (value > prev) {
      total += value - prev;
      bestByCategory.set(a.category, value);
    } else {
      total += value * 0.15;
    }
  }

  for (const t of evaluateTakeovers(ds, attrs, attrs, fakeCost)) {
    total += t.impact * 1.6 * t.unlockedTierIds.length;
  }

  return total;
}

// evaluateTakeovers only needs a CostModel to price the next tier, which
// unlockValue ignores. This stub keeps the hot path allocation-free.
const fakeCost = {
  cost: () => 0,
  pointCost: () => 0,
  totalCost: () => 0,
} as unknown as CostModel;

/**
 * Cap breakers are a post-build overlay: the build is already locked in, so the
 * only question is where the raises land.
 *
 * Each slot is worth a different, per-attribute amount that the builder
 * publishes (Steal's first slot is +7 on one frame, Close Shot's is +1), and
 * gains diminish down the row. So this is not "which single point crosses a
 * threshold" any more — it is a marginal-value allocation over a real table,
 * one slot at a time, always taking whichever next slot unlocks the most.
 *
 * With no table for this body it plans nothing and says why. Gains vary far too
 * much between attributes to extrapolate from another frame.
 */
export function planCapBreakers(
  ds: Dataset,
  attrs: AttributeVector,
  body: BuildBody,
  caps: AttributeVector,
  priorities: Record<string, number>
): {
  plan: CapBreakerRecommendation[];
  remaining: number;
  effective: AttributeVector;
  status: CapBreakerPlanStatus;
} {
  const cb = ds.capBreakers;
  const effective = { ...attrs };
  const table = capBreakerTableFor(ds, body);

  if (!cb.enabled) {
    return { plan: [], remaining: 0, effective, status: { kind: 'disabled', note: 'Cap breakers are disabled in this dataset.' } };
  }
  if (!table) {
    return {
      plan: [],
      remaining: 0,
      effective,
      status: {
        kind: 'no-data',
        note:
          'No cap breaker table has been transcribed for this body. Gains are per-attribute and vary ' +
          'from +1 to +7 on the one frame we have, so nothing is extrapolated — read this build off the ' +
          'NBA 2K HQ app and add it to cap-breakers.json.',
      },
    };
  }

  // 'shared-pool': a scarce resource to distribute. 'per-attribute': every row
  // fills independently. The file documents why the scarce reading is default.
  const perAttributeMode = cb.allocation.mode === 'per-attribute';
  const budget = perAttributeMode ? Number.POSITIVE_INFINITY : cb.allocation.poolSize;
  if (budget <= 0) {
    return { plan: [], remaining: 0, effective, status: { kind: 'no-breakers', note: 'This dataset grants no cap breakers.' } };
  }

  const pw = priorityWeights(ds, priorities);
  const plan: CapBreakerRecommendation[] = [];
  const usedPerAttribute: Record<string, number> = {};
  let remaining = budget;

  while (remaining > 0) {
    let best: { attr: string; slots: number; to: number; gain: number; density: number; unlocks: string[] } | null = null;
    const baseValue = unlockValue(ds, effective, body, pw);

    for (const a of ds.attributes) {
      if (!isCapBreakerEligible(ds, a.id)) continue;
      const row = table.attributes[a.id];
      const used = usedPerAttribute[a.id] ?? 0;
      const available = usableSlots(row) - used;
      if (available <= 0) continue; // locked, exhausted, or absent from the table

      const current = effective[a.id];
      const cap = caps[a.id];
      if (current === undefined || cap === undefined) continue;
      // A breaker raises the CAP, so it does nothing unless the attribute is
      // already sitting on it — below the cap, ordinary build points are cheaper.
      if (current < cap) continue;

      // Slots must be considered as RUNS, not one at a time. Pass Accuracy's
      // slots are +2 each and no single one of them crosses anything, but three
      // together do. A greedy that only ever looked one slot ahead would see a
      // zero gain, stop, and leave every remaining breaker unplaced.
      const maxRun = Math.min(available, Number.isFinite(remaining) ? remaining : available);
      for (let k = 1; k <= maxRun; k++) {
        const step = capBreakerGain(row, used + k) - capBreakerGain(row, used);
        if (step <= 0) continue;
        const next = Math.min(cb.absoluteCeiling, row!.newCap, current + step);
        if (next <= current) continue;

        const probe = { ...effective, [a.id]: next };
        const gain = unlockValue(ds, probe, body, pw) - baseValue;
        if (gain <= 0) continue;
        // Rank by value per slot spent, so a cheap unlock beats an expensive one
        // of the same size; ties go to the shorter run, which leaves more over.
        const density = gain / k;
        if (!best || density > best.density) {
          best = { attr: a.id, slots: k, to: next, gain, density, unlocks: newUnlockNames(ds, effective, probe, body) };
        }
      }
    }

    if (!best) break;

    const from = effective[best.attr]!;
    effective[best.attr] = best.to;
    usedPerAttribute[best.attr] = (usedPerAttribute[best.attr] ?? 0) + best.slots;
    remaining -= best.slots;

    const existing = plan.find((p) => p.attribute === best!.attr);
    if (existing) {
      existing.to = best.to;
      existing.breakersUsed += best.slots;
      existing.scoreGain = round2(existing.scoreGain + best.gain);
      existing.unlocks.push(...best.unlocks);
      existing.reason = breakerReason(existing.unlocks, existing.from, best.to);
    } else {
      plan.push({
        attribute: best.attr,
        attributeName: ds.attributes.find((a) => a.id === best!.attr)?.name ?? best.attr,
        from,
        to: best.to,
        breakersUsed: best.slots,
        reason: breakerReason(best.unlocks, from, best.to),
        unlocks: best.unlocks,
        scoreGain: round2(best.gain),
      });
    }
  }

  const used = plan.reduce((a, p) => a + p.breakersUsed, 0);
  const left = perAttributeMode ? 0 : Math.max(0, cb.allocation.poolSize - used);
  return {
    plan,
    remaining: left,
    effective,
    status: {
      kind: 'planned',
      tableLabel: table.label,
      note:
        perAttributeMode
          ? 'Every attribute fills its own slots independently in this dataset, so this is the full table applied.'
          : `${cb.allocation.poolSize} breaker${cb.allocation.poolSize === 1 ? '' : 's'} to place across all attributes.`,
    },
  };
}

function breakerReason(unlocks: string[], from: number, to: number): string {
  const move = `+${to - from} (${from} → ${to})`;
  return unlocks.length > 0
    ? `${move}, crossing ${unlocks.join(', ')}.`
    : `${move}, the largest raise available on an attribute already at its cap.`;
}

function newUnlockNames(ds: Dataset, before: AttributeVector, after: AttributeVector, body: BuildBody): string[] {
  const names: string[] = [];
  const beforeBadges = new Map(evaluateBadges(ds, before, body).map((b) => [b.badgeId, b.levelOrder]));
  for (const b of evaluateBadges(ds, after, body)) {
    const prev = beforeBadges.get(b.badgeId) ?? 0;
    if (b.levelOrder > prev) names.push(`${b.name} ${b.levelName}`);
  }
  const beforeAnims = new Set(evaluateAnimations(ds, before, body).map((a) => a.animationId));
  for (const a of evaluateAnimations(ds, after, body)) {
    if (!beforeAnims.has(a.animationId)) names.push(a.name);
  }
  const beforeTakeovers = new Map(evaluateTakeovers(ds, before, before, fakeCost).map((t) => [t.takeoverId, t.unlockedTierIds.length]));
  for (const t of evaluateTakeovers(ds, after, after, fakeCost)) {
    if (t.unlockedTierIds.length > (beforeTakeovers.get(t.takeoverId) ?? 0)) names.push(`${t.name} takeover`);
  }
  return names;
}

/**
 * Picks which badges to spend the +1 / +2 boost slots on. The +2 slot is
 * allocated first because a +2 on the wrong badge is the most expensive
 * mistake available here.
 */
export function planBadgeBoosts(
  ds: Dataset,
  attrs: AttributeVector,
  body: BuildBody,
  priorities: Record<string, number>
): BadgeBoostRecommendation[] {
  const cfg = ds.badgeBoosts;
  if (!cfg.enabled) return [];

  const pw = priorityWeights(ds, priorities);
  const unlocked = evaluateBadges(ds, attrs, body);
  const levelsAsc = [...ds.badgeLevels].sort((a, b) => a.order - b.order);
  const minOrder = ds.badgeLevels.find((l) => l.id === cfg.rules.minimumLevelToBoost)?.order ?? 1;
  const maxOrder = levelsAsc[levelsAsc.length - 1]?.order ?? 5;
  const legendOrder = maxOrder;
  // Synergy slots are EARNED, so plan against what this account actually has
  // rather than the 16 the system tops out at.
  const plusTwoSlots = cfg.availableSlots?.plusTwo ?? cfg.plusTwo.slots;
  const plusOneSlots = cfg.availableSlots?.plusOne ?? cfg.plusOne.slots;

  const candidates = unlocked.filter((b) => {
    if (cfg.rules.excludedBadges.includes(b.badgeId)) return false;
    if (cfg.rules.eligibleCategories.length && !cfg.rules.eligibleCategories.includes(b.category)) return false;
    if (cfg.rules.requiresBadgeAlreadyUnlocked && b.levelOrder < minOrder) return false;
    return b.levelOrder < maxOrder;
  });

  const focusOf = (badgeId: string) => {
    const def = ds.badges.find((x) => x.id === badgeId);
    const ids = [...new Set(def?.tiers.flatMap((t) => t.requires.flatMap(clauseOptions).map((r) => r.attribute)) ?? [])];
    return ids.length ? ids.reduce((a, id) => a + (pw[id] ?? 0), 0) / ids.length : 0;
  };

  const gainFor = (badge: (typeof candidates)[number], levels: number) => {
    let targetOrder = Math.min(maxOrder, badge.levelOrder + levels);
    if (!cfg.rules.canBoostToLegend && targetOrder >= legendOrder) targetOrder = legendOrder - 1;
    if (targetOrder <= badge.levelOrder) return null;
    const from = levelsAsc.find((l) => l.order === badge.levelOrder);
    const to = levelsAsc.find((l) => l.order === targetOrder);
    if (!to) return null;
    const focus = focusOf(badge.badgeId);
    const gain = (to.scoreWeight - (from?.scoreWeight ?? 0)) * badge.impact * (0.35 + 1.65 * focus);
    return { to, from, gain };
  };

  const out: BadgeBoostRecommendation[] = [];
  const taken = new Set<string>();

  const allocate = (slot: 'plusOne' | 'plusTwo', slots: number, levels: number) => {
    for (let i = 0; i < slots; i++) {
      let best: { badge: (typeof candidates)[number]; to: { id: string; name: string }; from?: { id: string; name: string }; gain: number } | null = null;
      for (const badge of candidates) {
        if (!cfg.rules.canStackOnSameBadge && taken.has(badge.badgeId)) continue;
        const g = gainFor(badge, levels);
        if (!g) continue;
        if (!best || g.gain > best.gain) best = { badge, to: g.to, from: g.from, gain: g.gain };
      }
      if (!best || best.gain <= 0) return;
      taken.add(best.badge.badgeId);
      out.push({
        slot,
        badgeId: best.badge.badgeId,
        badgeName: best.badge.name,
        fromLevel: best.from?.id ?? null,
        fromLevelName: levelName(ds, best.from?.id ?? null),
        toLevel: best.to.id,
        toLevelName: best.to.name,
        scoreGain: round2(best.gain),
        reason:
          `${best.badge.name} is the highest-impact badge you hold that is not already maxed, on an attribute this build cares about.` +
          (ds.badgeBoosts.rules.fuseRefundsTokens
            ? ' Fusing it also refunds the badge tokens spent equipping it.'
            : ''),
      });
    }
  };

  allocate('plusTwo', plusTwoSlots, cfg.plusTwo.levelsGained);
  allocate('plusOne', plusOneSlots, cfg.plusOne.levelsGained);

  return out;
}

/**
 * Finds points sitting above the last rating that unlocked anything. This is
 * the "you are wasting points" report, and it is deliberately literal: it only
 * counts points above a threshold that the dataset knows about.
 */
export function findWaste(
  ds: Dataset,
  attrs: AttributeVector,
  breakpoints: BreakpointMap,
  cost: CostModel
): WasteFinding[] {
  const out: WasteFinding[] = [];
  for (const a of ds.attributes) {
    const value = attrs[a.id];
    if (value === undefined || value <= ds.ratingFloor) continue;
    const bps = breakpoints[a.id] ?? [];
    const useful = lastUsefulBreakpoint(bps, value);
    if (value <= useful) continue;

    const wastedPoints = value - useful;
    const refundable = cost.cost(a.id, useful, value);
    const nextBp = bps.find((b) => b.value > value && b.sources.some((s) => s.kind !== 'cap' && s.kind !== 'floor'));
    const severity: WasteFinding['severity'] = refundable >= 60 ? 'critical' : refundable >= 20 ? 'warning' : 'info';

    const nextNote = nextBp
      ? ` The next thing ${a.name} unlocks is at ${nextBp.value} (${nextBp.sources[0]?.label ?? 'threshold'}), ${cost.cost(a.id, value, nextBp.value)} more points.`
      : ` Nothing in the dataset unlocks above ${useful} for ${a.name}.`;

    out.push({
      attribute: a.id,
      attributeName: a.name,
      value,
      lastUsefulValue: useful,
      wastedPoints,
      refundableBuildPoints: refundable,
      severity,
      message: `${a.name} ${value} is ${wastedPoints} point${wastedPoints === 1 ? '' : 's'} above ${useful}, the last rating that unlocks anything. Dropping to ${useful} frees ${refundable} build points with no known loss.${nextNote}`,
    });
  }
  return out.sort((a, b) => b.refundableBuildPoints - a.refundableBuildPoints);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
