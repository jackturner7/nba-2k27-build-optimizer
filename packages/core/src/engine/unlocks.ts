import type {
  AttributeVector,
  BuildBody,
  Dataset,
  NextAnimationThreshold,
  NextBadgeThreshold,
  TakeoverStatus,
  UnlockedAnimation,
  UnlockedBadge,
} from '../types.js';
import type { CostModel } from './cost.js';
import { bodyBlockReason, costToClose, gapsFor, meetsBody, meetsRequirements } from './requirements.js';

/**
 * Highest badge level earned by an attribute vector.
 *
 * A ladder is walked from the bottom: a build cannot hold Gold without also
 * satisfying Silver, no matter how the data file is written.
 */
export function badgeLevelFor(
  ds: Dataset,
  badge: Dataset['badges'][number],
  attrs: AttributeVector,
  body: BuildBody
): { level: string; order: number } | null {
  if (badge.restrictions) {
    if (!meetsBody(body, badge.restrictions)) return null;
    if (badge.restrictions.positions && !badge.restrictions.positions.includes(body.position)) return null;
  }
  let best: { level: string; order: number } | null = null;
  for (const tier of badge.tiers) {
    if (!meetsRequirements(tier.requires, attrs)) break;
    const order = levelOrder(ds, tier.level);
    best = { level: tier.level, order };
  }
  return best;
}

const levelOrderCache = new WeakMap<Dataset, Map<string, number>>();
const levelNameCache = new WeakMap<Dataset, Map<string, string>>();

export function levelOrder(ds: Dataset, level: string): number {
  let m = levelOrderCache.get(ds);
  if (!m) {
    m = new Map(ds.badgeLevels.map((l) => [l.id, l.order]));
    levelOrderCache.set(ds, m);
  }
  return m.get(level) ?? 0;
}

export function levelName(ds: Dataset, level: string | null): string {
  if (!level) return 'Locked';
  let m = levelNameCache.get(ds);
  if (!m) {
    m = new Map(ds.badgeLevels.map((l) => [l.id, l.name]));
    levelNameCache.set(ds, m);
  }
  return m.get(level) ?? level;
}

export function levelWeight(ds: Dataset, level: string): number {
  const def = ds.badgeLevels.find((l) => l.id === level);
  return def?.scoreWeight ?? 0;
}

export function evaluateBadges(
  ds: Dataset,
  attrs: AttributeVector,
  body: BuildBody
): UnlockedBadge[] {
  const out: UnlockedBadge[] = [];
  for (const badge of ds.badges) {
    const level = badgeLevelFor(ds, badge, attrs, body);
    if (!level) continue;
    out.push({
      badgeId: badge.id,
      name: badge.name,
      category: badge.category,
      impact: badge.impact,
      level: level.level,
      levelName: levelName(ds, level.level),
      levelOrder: level.order,
      verification: badge.verification,
    });
  }
  return out.sort((a, b) => b.levelOrder * b.impact - a.levelOrder * a.impact || a.name.localeCompare(b.name));
}

export function nextBadgeThresholds(
  ds: Dataset,
  attrs: AttributeVector,
  body: BuildBody,
  caps: AttributeVector,
  cost: CostModel,
  limit = 12
): NextBadgeThreshold[] {
  const out: NextBadgeThreshold[] = [];
  for (const badge of ds.badges) {
    if (badge.restrictions) {
      if (!meetsBody(body, badge.restrictions)) continue;
      if (badge.restrictions.positions && !badge.restrictions.positions.includes(body.position)) continue;
    }
    const current = badgeLevelFor(ds, badge, attrs, body);
    const currentOrder = current?.order ?? 0;
    const nextTier = badge.tiers.find((t) => levelOrder(ds, t.level) > currentOrder);
    if (!nextTier) continue;
    const gaps = gapsFor(ds, nextTier.requires, attrs);
    if (gaps.length === 0) continue;
    const pointCost = costToClose(cost, gaps, caps);
    if (!Number.isFinite(pointCost)) continue; // unreachable at this body
    out.push({
      badgeId: badge.id,
      name: badge.name,
      category: badge.category,
      impact: badge.impact,
      currentLevel: current?.level ?? null,
      nextLevel: nextTier.level,
      nextLevelName: levelName(ds, nextTier.level),
      gaps,
      pointCost,
      verification: badge.verification,
    });
  }
  // Cheapest meaningful upgrades first: value per point.
  return out
    .sort((a, b) => valueDensity(ds, b) - valueDensity(ds, a))
    .slice(0, limit);
}

function valueDensity(ds: Dataset, t: NextBadgeThreshold): number {
  const gain = levelWeight(ds, t.nextLevel) - (t.currentLevel ? levelWeight(ds, t.currentLevel) : 0);
  return (gain * t.impact) / Math.max(1, t.pointCost);
}

export function evaluateAnimations(
  ds: Dataset,
  attrs: AttributeVector,
  body: BuildBody
): UnlockedAnimation[] {
  const out: UnlockedAnimation[] = [];
  for (const anim of ds.animations) {
    if (!meetsBody(body, anim.bodyRequires)) continue;
    if (!meetsRequirements(anim.requires, attrs)) continue;
    out.push({
      animationId: anim.id,
      name: anim.name,
      category: anim.category,
      impact: anim.impact,
      verification: anim.verification,
    });
  }
  return out.sort((a, b) => b.impact - a.impact || a.name.localeCompare(b.name));
}

export function nextAnimationThresholds(
  ds: Dataset,
  attrs: AttributeVector,
  body: BuildBody,
  caps: AttributeVector,
  cost: CostModel,
  limit = 12
): NextAnimationThreshold[] {
  const out: NextAnimationThreshold[] = [];
  for (const anim of ds.animations) {
    if (meetsRequirements(anim.requires, attrs) && meetsBody(body, anim.bodyRequires)) continue;
    const blocked = !meetsBody(body, anim.bodyRequires);
    const gaps = gapsFor(ds, anim.requires, attrs);
    const pointCost = costToClose(cost, gaps, caps);
    if (!blocked && !Number.isFinite(pointCost)) continue;
    out.push({
      animationId: anim.id,
      name: anim.name,
      category: anim.category,
      impact: anim.impact,
      gaps,
      bodyBlocked: blocked,
      bodyBlockReason: bodyBlockReason(ds, body, anim.bodyRequires),
      pointCost: Number.isFinite(pointCost) ? pointCost : Number.POSITIVE_INFINITY,
      verification: anim.verification,
    });
  }
  return out
    .sort((a, b) => {
      if (a.bodyBlocked !== b.bodyBlocked) return a.bodyBlocked ? 1 : -1;
      return b.impact / Math.max(1, b.pointCost) - a.impact / Math.max(1, a.pointCost);
    })
    .slice(0, limit);
}

/**
 * Unlock state only — no next-tier pricing. The optimizer's inner loop calls
 * this thousands of times and never looks at the next tier.
 */
export function evaluateTakeoversLight(ds: Dataset, attrs: AttributeVector): TakeoverStatus[] {
  const out: TakeoverStatus[] = [];
  for (const t of ds.takeovers) {
    const unlocked: string[] = [];
    let highestName: string | null = null;
    for (const tier of t.tiers) {
      if (!meetsRequirements(tier.requires, attrs)) break;
      unlocked.push(tier.id);
      highestName = tier.name;
    }
    out.push({
      takeoverId: t.id,
      name: t.name,
      impact: t.impact,
      unlockedTierIds: unlocked,
      highestTierName: highestName,
      verification: t.verification,
    });
  }
  return out;
}

export function evaluateTakeovers(
  ds: Dataset,
  attrs: AttributeVector,
  caps: AttributeVector,
  cost: CostModel
): TakeoverStatus[] {
  const out: TakeoverStatus[] = [];
  for (const t of ds.takeovers) {
    const unlocked: string[] = [];
    let highestName: string | null = null;
    for (const tier of t.tiers) {
      if (!meetsRequirements(tier.requires, attrs)) break;
      unlocked.push(tier.id);
      highestName = tier.name;
    }
    const nextTier = t.tiers[unlocked.length];
    let next: TakeoverStatus['nextTier'];
    if (nextTier) {
      const gaps = gapsFor(ds, nextTier.requires, attrs);
      const pointCost = costToClose(cost, gaps, caps);
      if (Number.isFinite(pointCost)) {
        next = { id: nextTier.id, name: nextTier.name, gaps, pointCost };
      }
    }
    out.push({
      takeoverId: t.id,
      name: t.name,
      impact: t.impact,
      unlockedTierIds: unlocked,
      highestTierName: highestName,
      ...(next ? { nextTier: next } : {}),
      verification: t.verification,
    });
  }
  return out.sort((a, b) => b.unlockedTierIds.length * b.impact - a.unlockedTierIds.length * a.impact);
}
