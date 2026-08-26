import type {
  AttributeVector,
  BadgeDef,
  BuildBody,
  Dataset,
  DisciplineTokenReport,
  EquippedBadge,
  TokenReport,
  UnlockedBadge,
} from '../types.js';
import { meetsBody, meetsRequirements } from './requirements.js';
import { levelName, levelOrder, levelWeight } from './unlocks.js';

/**
 * Badge tokens earned per discipline.
 *
 * 2K27 grants tokens for investing in a discipline's attributes — raising
 * Three-Point earns shooting tokens. The exact curve is unknown, so the default
 * model only captures the direction (more investment, more tokens). Override
 * per discipline with real in-game numbers when you have them.
 */
export function computeTokens(
  ds: Dataset,
  attrs: AttributeVector,
  overrides?: Record<string, number | null>
): Record<string, number> {
  const cfg = ds.badgeTokens;
  const out: Record<string, number> = {};
  if (!cfg.enabled) {
    for (const d of cfg.disciplines) out[d] = Number.POSITIVE_INFINITY;
    return out;
  }

  const attrsByCategory = new Map<string, string[]>();
  for (const a of ds.attributes) {
    const list = attrsByCategory.get(a.category) ?? [];
    list.push(a.id);
    attrsByCategory.set(a.category, list);
  }

  for (const discipline of cfg.disciplines) {
    const override = overrides?.[discipline] ?? cfg.manualTokens[discipline];
    if (override !== null && override !== undefined) {
      out[discipline] = Math.max(0, Math.round(override));
      continue;
    }

    if (cfg.tokenGrants.mode === 'manual') {
      // Manual mode with nothing set means "unknown"; treat as unconstrained
      // rather than silently starving the build of badges.
      out[discipline] = Number.POSITIVE_INFINITY;
      continue;
    }

    if (cfg.tokenGrants.mode === 'flat') {
      // 2K27 earns tokens by PLAYING — discipline meters, practice drills,
      // Gatorade workouts — not by how attributes are allocated. So the pool is
      // a fact about the account, not about the build.
      out[discipline] = Math.max(0, Math.round(cfg.tokenGrants.flatByDiscipline[discipline] ?? 0));
      continue;
    }

    if (cfg.tokenGrants.mode === 'table') {
      const rows = cfg.tokenGrants.table[discipline] ?? [];
      let total = 0;
      for (const row of rows) {
        if ((attrs[row.attribute] ?? 0) >= row.rating) total += row.tokens;
      }
      out[discipline] = Math.min(cfg.tokenGrants.maxPerDiscipline, total);
      continue;
    }

    // linear-by-investment
    const ids = attrsByCategory.get(discipline) ?? [];
    let invested = 0;
    for (const id of ids) invested += Math.max(0, (attrs[id] ?? 0) - cfg.tokenGrants.freeBelow);
    out[discipline] = Math.min(
      cfg.tokenGrants.maxPerDiscipline,
      Math.floor(invested / Math.max(1, cfg.tokenGrants.pointsPerToken))
    );
  }
  return out;
}

interface BadgeOption {
  badge: BadgeDef;
  level: string;
  levelOrder: number;
  tokenCost: number;
  /** True when tokenCost came from the fallback rather than sourced data. */
  inferred: boolean;
  value: number;
}

/**
 * The token price of a tier, or null when it genuinely cannot be priced.
 *
 * Some badges have no sourced cost (the Rebounding and Physicals cost charts
 * were never supplied). Rather than making those badges permanently
 * unequippable — which quietly breaks every big-man build — the dataset can
 * supply a fallback price. Anything priced that way is flagged all the way
 * through to the UI so it is never mistaken for real data.
 */
function priceOf(
  ds: Dataset,
  badge: BadgeDef,
  tier: BadgeDef['tiers'][number],
  body: BuildBody
): { cost: number; inferred: boolean } | null {
  let base: number;
  let inferred: boolean;

  if (tier.tokenCost !== null) {
    base = tier.tokenCost;
    inferred = false;
  } else {
    const fallback = ds.badgeTokens.fallbackTokenCost;
    if (!fallback?.enabled) return null;
    const cost = fallback.byLevel[tier.level];
    if (cost === undefined) return null;
    base = cost;
    inferred = true;
  }

  // 2K states outright that badge token cost varies with size and position.
  // The chart costs are a single-body snapshot, so this adjusts them — by zero
  // until someone supplies the real relationship, which is a known gap rather
  // than an assertion that no relationship exists.
  const byBody = ds.badgeTokens.costByBody;
  if (byBody?.enabled) {
    const override = byBody.overrides[`${badge.id}:${tier.level}:${body.position}:${body.heightInches}`];
    if (override !== undefined) return { cost: override, inferred: false };
    if (byBody.perInchHeight !== 0 && byBody.referenceHeightInches !== null) {
      const adjusted = base + byBody.perInchHeight * (body.heightInches - byBody.referenceHeightInches);
      base = Math.max(byBody.minCost, Math.round(adjusted));
      inferred = true;
    }
  }

  return { cost: base, inferred };
}

/**
 * The best badge tier this build is eligible for, per badge. Attributes decide
 * eligibility; tokens decide what actually gets equipped.
 */
function eligibleOptions(
  ds: Dataset,
  attrs: AttributeVector,
  body: BuildBody,
  discipline: string,
  focusOf: (badge: BadgeDef) => number
): { options: BadgeOption[]; unpriced: BadgeDef[] } {
  const options: BadgeOption[] = [];
  const unpriced: BadgeDef[] = [];

  for (const badge of ds.badges) {
    if (badge.category !== discipline) continue;
    if (badge.restrictions) {
      if (!meetsBody(body, badge.restrictions)) continue;
      if (badge.restrictions.positions && !badge.restrictions.positions.includes(body.position)) continue;
    }

    let sawUnpriced = false;
    for (const tier of badge.tiers) {
      if (!meetsRequirements(tier.requires, attrs)) break; // ladder: stop at the first unmet tier
      const price = priceOf(ds, badge, tier, body);
      if (!price) {
        sawUnpriced = true;
        continue;
      }
      options.push({
        badge,
        level: tier.level,
        levelOrder: levelOrder(ds, tier.level),
        tokenCost: price.cost,
        inferred: price.inferred,
        value: levelWeight(ds, tier.level) * badge.impact * (0.35 + 1.65 * focusOf(badge)),
      });
    }
    if (sawUnpriced) unpriced.push(badge);
  }

  return { options, unpriced };
}

export interface LoadoutResult {
  equipped: EquippedBadge[];
  report: TokenReport;
}

/**
 * Chooses which badges to equip.
 *
 * Per discipline this is a two-dimensional knapsack — token budget and badge
 * slots — over at most one tier per badge. The state space is tiny (a handful
 * of badges, single-digit slots, a couple dozen tokens) so it is solved exactly.
 */
export function planBadgeLoadout(
  ds: Dataset,
  attrs: AttributeVector,
  body: BuildBody,
  tokens: Record<string, number>,
  priorityWeightsByAttribute: Record<string, number>,
  eligible: UnlockedBadge[]
): LoadoutResult {
  const cfg = ds.badgeTokens;
  const badgeAttrs = new Map(
    ds.badges.map((b) => [b.id, [...new Set(b.tiers.flatMap((t) => t.requires.flatMap((c) => ('anyOf' in c ? c.anyOf : [c]).map((o) => o.attribute))))]])
  );
  const focusOf = (badge: BadgeDef) => {
    const ids = badgeAttrs.get(badge.id) ?? [];
    return ids.length ? ids.reduce((a, id) => a + (priorityWeightsByAttribute[id] ?? 0), 0) / ids.length : 0;
  };

  const equipped: EquippedBadge[] = [];
  const byDiscipline: DisciplineTokenReport[] = [];
  const unpricedBadges: string[] = [];
  const inferredCostBadges: string[] = [];

  for (const discipline of cfg.disciplines) {
    const budget = tokens[discipline] ?? 0;
    const slots = cfg.slots.byDiscipline[discipline] ?? 0;
    const { options, unpriced } = eligibleOptions(ds, attrs, body, discipline, focusOf);
    for (const b of unpriced) unpricedBadges.push(b.name);

    const picks = solveDiscipline(options, budget, slots);
    const pickedIds = new Set(picks.map((p) => `${p.badge.id}:${p.level}`));

    let spent = 0;
    for (const p of picks) {
      spent += p.tokenCost;
      equipped.push({
        badgeId: p.badge.id,
        name: p.badge.name,
        category: p.badge.category,
        impact: p.badge.impact,
        level: p.level,
        levelName: levelName(ds, p.level),
        levelOrder: p.levelOrder,
        tokenCost: p.tokenCost,
        ...(p.inferred ? { tokenCostInferred: true } : {}),
        verification: p.badge.verification,
      });
      if (p.inferred) inferredCostBadges.push(p.badge.name);
    }

    // Report what was eligible but did not make the cut, and why.
    const bestUnequipped = new Map<string, BadgeOption>();
    for (const o of options) {
      if (pickedIds.has(`${o.badge.id}:${o.level}`)) continue;
      if (picks.some((p) => p.badge.id === o.badge.id && p.levelOrder >= o.levelOrder)) continue;
      const prev = bestUnequipped.get(o.badge.id);
      if (!prev || o.levelOrder > prev.levelOrder) bestUnequipped.set(o.badge.id, o);
    }

    const remaining = Number.isFinite(budget) ? budget - spent : Number.POSITIVE_INFINITY;
    const unaffordable: DisciplineTokenReport['unaffordable'] = [...bestUnequipped.values()].map((o) => ({
      badgeId: o.badge.id,
      name: o.badge.name,
      level: o.level,
      levelName: levelName(ds, o.level),
      tokenCost: o.tokenCost,
      reason:
        picks.length >= slots
          ? `No ${discipline} badge slots left (${slots} available).`
          : o.tokenCost > remaining
            ? `Costs ${o.tokenCost} tokens, only ${remaining} left.`
            : 'A higher-value badge won the slot.',
    }));

    for (const b of unpriced) {
      unaffordable.push({
        badgeId: b.id,
        name: b.name,
        level: b.tiers[0]?.level ?? 'unknown',
        levelName: levelName(ds, b.tiers[0]?.level ?? null),
        tokenCost: null,
        reason: 'Token cost unknown in this dataset, so it cannot be planned.',
      });
    }

    byDiscipline.push({
      discipline,
      earned: budget,
      spent,
      remaining,
      slots,
      slotsUsed: picks.length,
      unaffordable,
    });
  }

  // Reflect the loadout back onto the eligibility list so the UI can mark which
  // eligible badges the build can actually afford.
  const equippedKeys = new Set(equipped.map((e) => e.badgeId));
  for (const b of eligible) {
    (b as UnlockedBadge & { equipped?: boolean }).equipped = equippedKeys.has(b.badgeId);
  }

  const finite = (n: number) => (Number.isFinite(n) ? n : 0);
  return {
    equipped: equipped.sort((a, b) => b.levelOrder * b.impact - a.levelOrder * a.impact || a.name.localeCompare(b.name)),
    report: {
      enabled: cfg.enabled,
      byDiscipline,
      totalEarned: byDiscipline.reduce((a, d) => a + finite(d.earned), 0),
      totalSpent: byDiscipline.reduce((a, d) => a + d.spent, 0),
      totalSlots: byDiscipline.reduce((a, d) => a + d.slots, 0),
      totalSlotsUsed: byDiscipline.reduce((a, d) => a + d.slotsUsed, 0),
      unpricedBadges: [...new Set(unpricedBadges)],
      inferredCostBadges: [...new Set(inferredCostBadges)],
    },
  };
}

/** Exact 2D knapsack over (tokens, slots), at most one tier per badge. */
function solveDiscipline(options: BadgeOption[], budget: number, slots: number): BadgeOption[] {
  if (slots <= 0 || options.length === 0) return [];

  const byBadge = new Map<string, BadgeOption[]>();
  for (const o of options) {
    const list = byBadge.get(o.badge.id) ?? [];
    list.push(o);
    byBadge.set(o.badge.id, list);
  }
  const groups = [...byBadge.values()];

  // Unbounded token budget: just take the best tier of the highest-value badges
  // until the slots run out.
  if (!Number.isFinite(budget)) {
    return groups
      .map((g) => g.reduce((a, b) => (b.value > a.value ? b : a)))
      .sort((a, b) => b.value - a.value)
      .slice(0, slots);
  }

  const T = Math.max(0, Math.floor(budget));
  const width = (slots + 1) * (T + 1);
  const idx = (s: number, t: number) => s * (T + 1) + t;

  let dp = new Float64Array(width).fill(-Infinity);
  dp[idx(0, 0)] = 0;
  const choices: Int16Array[] = [];

  for (const group of groups) {
    const next = new Float64Array(width).fill(-Infinity);
    const choice = new Int16Array(width).fill(-1);
    for (let s = 0; s <= slots; s++) {
      for (let t = 0; t <= T; t++) {
        const current = dp[idx(s, t)]!;
        if (current === -Infinity) continue;
        // Skip this badge.
        if (current > next[idx(s, t)]!) {
          next[idx(s, t)] = current;
          choice[idx(s, t)] = -1;
        }
        if (s === slots) continue;
        for (let k = 0; k < group.length; k++) {
          const o = group[k]!;
          const t2 = t + o.tokenCost;
          if (t2 > T) continue;
          const value = current + o.value;
          if (value > next[idx(s + 1, t2)]!) {
            next[idx(s + 1, t2)] = value;
            choice[idx(s + 1, t2)] = k;
          }
        }
      }
    }
    dp = next;
    choices.push(choice);
  }

  let bestS = 0;
  let bestT = 0;
  let bestValue = -Infinity;
  for (let s = 0; s <= slots; s++) {
    for (let t = 0; t <= T; t++) {
      if (dp[idx(s, t)]! > bestValue) {
        bestValue = dp[idx(s, t)]!;
        bestS = s;
        bestT = t;
      }
    }
  }
  if (bestValue === -Infinity) return [];

  const picked: BadgeOption[] = [];
  let s = bestS;
  let t = bestT;
  for (let i = groups.length - 1; i >= 0; i--) {
    const k = choices[i]![idx(s, t)]!;
    if (k >= 0) {
      const o = groups[i]![k]!;
      picked.push(o);
      s -= 1;
      t -= o.tokenCost;
    }
  }
  return picked.reverse();
}

/**
 * Fast approximation of {@link planBadgeLoadout} for the optimizer's inner loop,
 * which scores tens of thousands of candidate builds. Greedy by value per token;
 * the final reported loadout always uses the exact solver above.
 */
export function planBadgeLoadoutFast(
  ds: Dataset,
  attrs: AttributeVector,
  body: BuildBody,
  tokens: Record<string, number>,
  priorityWeightsByAttribute: Record<string, number>,
  badgeAttrs: Map<string, string[]>
): { badgeId: string; level: string; levelOrder: number; impact: number; category: string; focus: number }[] {
  const cfg = ds.badgeTokens;
  const out: { badgeId: string; level: string; levelOrder: number; impact: number; category: string; focus: number }[] = [];

  const focusOf = (badge: BadgeDef) => {
    const ids = badgeAttrs.get(badge.id) ?? [];
    return ids.length ? ids.reduce((a, id) => a + (priorityWeightsByAttribute[id] ?? 0), 0) / ids.length : 0;
  };

  for (const discipline of cfg.disciplines) {
    let budget = tokens[discipline] ?? 0;
    let slots = cfg.slots.byDiscipline[discipline] ?? 0;
    if (slots <= 0) continue;

    // Best affordable tier per badge.
    const best: { badge: BadgeDef; level: string; levelOrder: number; cost: number; value: number; focus: number }[] = [];
    for (const badge of ds.badges) {
      if (badge.category !== discipline) continue;
      if (badge.restrictions) {
        if (!meetsBody(body, badge.restrictions)) continue;
        if (badge.restrictions.positions && !badge.restrictions.positions.includes(body.position)) continue;
      }
      const focus = focusOf(badge);
      let chosen: { level: string; levelOrder: number; cost: number; value: number } | null = null;
      for (const tier of badge.tiers) {
        if (!meetsRequirements(tier.requires, attrs)) break;
        const price = priceOf(ds, badge, tier, body);
        if (!price) continue;
        chosen = {
          level: tier.level,
          levelOrder: levelOrder(ds, tier.level),
          cost: price.cost,
          value: levelWeight(ds, tier.level) * badge.impact * (0.35 + 1.65 * focus),
        };
      }
      if (chosen) best.push({ badge, focus, ...chosen });
    }

    best.sort((a, b) => b.value / Math.max(1, b.cost) - a.value / Math.max(1, a.cost));
    for (const candidate of best) {
      if (slots <= 0) break;
      if (Number.isFinite(budget) && candidate.cost > budget) continue;
      budget -= candidate.cost;
      slots -= 1;
      out.push({
        badgeId: candidate.badge.id,
        level: candidate.level,
        levelOrder: candidate.levelOrder,
        impact: candidate.badge.impact,
        category: candidate.badge.category,
        focus: candidate.focus,
      });
    }
  }
  return out;
}
