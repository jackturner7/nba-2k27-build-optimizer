import type {
  AttributeVector,
  BuildBody,
  CapBreakerRow,
  CapBreakerTable,
  CapOverrideEntry,
  Dataset,
} from '../types.js';
import { clamp } from './body.js';

/**
 * Looks up a body-keyed table. Keys are `POSITION|height|weight|wingspan` where
 * any field may be `*`. The most specific matching key wins, so you can ship a
 * blanket rule and then refine individual bodies.
 *
 * Both the exact cap tables and the cap breaker gain tables are keyed this way,
 * so a body that has one usually has the other.
 */
export function lookupByBody<T>(entries: Record<string, T> | undefined, body: BuildBody): T | null {
  if (!entries) return null;
  const fields = [body.position, String(body.heightInches), String(body.weightPounds), String(body.wingspanInches)];

  let best: { specificity: number; value: T } | null = null;
  for (const [key, value] of Object.entries(entries)) {
    const parts = key.split('|');
    if (parts.length !== 4) continue;
    let specificity = 0;
    let matched = true;
    for (let i = 0; i < 4; i++) {
      const p = parts[i]!;
      if (p === '*') continue;
      if (p !== fields[i]) {
        matched = false;
        break;
      }
      specificity++;
    }
    if (!matched) continue;
    if (!best || specificity > best.specificity) best = { specificity, value };
  }
  return best?.value ?? null;
}

/**
 * The exact cap table for this body, if one has been transcribed from the real
 * builder. `null` means the caps are coming from the invented linear model, and
 * the UI says so rather than presenting a guess as a fact.
 */
export function capOverrideFor(ds: Dataset, body: BuildBody): CapOverrideEntry | null {
  return lookupByBody(ds.caps.overrides, body);
}

/** Per-attribute maximums produced by the chosen body settings. */
export function computeCaps(ds: Dataset, body: BuildBody): AttributeVector {
  const ref = ds.caps.capModel.referenceBody;
  const overrides = capOverrideFor(ds, body)?.caps ?? {};
  const caps: AttributeVector = {};

  for (const rule of ds.caps.attributeCaps) {
    const override = overrides[rule.attribute];
    if (override !== undefined) {
      caps[rule.attribute] = clamp(Math.round(override), ds.ratingFloor, ds.ratingCeiling);
      continue;
    }
    const raw =
      rule.baseCap +
      rule.perInchHeight * (body.heightInches - ref.heightInches) +
      rule.perPoundWeight * (body.weightPounds - ref.weightPounds) +
      rule.perInchWingspan * (body.wingspanInches - ref.wingspanInches) +
      (rule.positionAdjust?.[body.position] ?? 0);

    caps[rule.attribute] = clamp(
      Math.round(clamp(raw, rule.hardMin, rule.hardMax)),
      ds.ratingFloor,
      ds.ratingCeiling
    );
  }
  return caps;
}

/** Total build points available for this body. */
export function computeBudget(ds: Dataset, body: BuildBody): number {
  const b = ds.budget;
  if (!b.enabled) return Number.POSITIVE_INFINITY;
  const ref = b.referenceBody;
  const raw =
    b.base +
    b.perInchHeight * (body.heightInches - ref.heightInches) +
    b.perPoundWeight * (body.weightPounds - ref.weightPounds) +
    b.perInchWingspan * (body.wingspanInches - ref.wingspanInches) +
    (b.positionAdjust[body.position] ?? 0);
  return Math.max(b.minimum, Math.round(raw));
}

/** Every attribute at the rating floor — the starting point for any build. */
export function baseAttributes(ds: Dataset): AttributeVector {
  const v: AttributeVector = {};
  for (const a of ds.attributes) v[a.id] = ds.ratingFloor;
  return v;
}

/** The transcribed cap breaker gain table for this body, or null if none. */
export function capBreakerTableFor(ds: Dataset, body: BuildBody): CapBreakerTable | null {
  return lookupByBody(ds.capBreakers.gainTables?.entries, body);
}

/**
 * What filling the first `count` breaker slots on one attribute is worth. Slots
 * must be filled in order, and a locked slot (`null`) stops the row there — you
 * cannot skip past it to reach a later one.
 */
export function capBreakerGain(row: CapBreakerRow | undefined, count: number): number {
  if (!row) return 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const g = row.slots[i];
    if (g === null || g === undefined) break;
    total += g;
  }
  return total;
}

/** How many of an attribute's breaker slots are actually usable on this body. */
export function usableSlots(row: CapBreakerRow | undefined): number {
  if (!row) return 0;
  let n = 0;
  for (const g of row.slots) {
    if (g === null || g === undefined) break;
    n++;
  }
  return n;
}

/**
 * Applies a cap breaker plan (attribute -> slots filled) on top of the builder
 * caps, using the body's real gain table.
 */
export function capsWithBreakers(
  ds: Dataset,
  caps: AttributeVector,
  body: BuildBody,
  plan: Record<string, number>
): AttributeVector {
  const cb = ds.capBreakers;
  if (!cb.enabled) return caps;
  const table = capBreakerTableFor(ds, body);
  if (!table) return caps;

  const out = { ...caps };
  for (const [attr, count] of Object.entries(plan)) {
    if (count <= 0) continue;
    const base = out[attr];
    if (base === undefined) continue;
    const row = table.attributes[attr];
    const gain = capBreakerGain(row, Math.min(count, usableSlots(row)));
    if (gain <= 0) continue;
    out[attr] = Math.min(cb.absoluteCeiling, row?.newCap ?? cb.absoluteCeiling, base + gain);
  }
  return out;
}

export function isCapBreakerEligible(ds: Dataset, attribute: string): boolean {
  const e = ds.capBreakers.eligibility;
  if (e.mode === 'all') return true;
  if (e.mode === 'all-except') return !e.excludedAttributes.includes(attribute);
  return ds.capBreakers.includedAttributes.includes(attribute);
}
