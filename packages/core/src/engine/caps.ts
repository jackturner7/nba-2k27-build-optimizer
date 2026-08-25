import type { AttributeVector, BuildBody, Dataset } from '../types.js';
import { clamp } from './body.js';

/**
 * Cap override lookup. Keys are `POSITION|height|weight|wingspan` where any
 * field may be `*`. The most specific matching key wins, so you can ship a
 * blanket rule and then refine individual bodies.
 */
function overrideCaps(ds: Dataset, body: BuildBody): Partial<AttributeVector> {
  const entries = ds.caps.overrides;
  if (!entries || Object.keys(entries).length === 0) return {};
  const fields = [body.position, String(body.heightInches), String(body.weightPounds), String(body.wingspanInches)];

  let best: { specificity: number; caps: Partial<AttributeVector> } | null = null;
  for (const [key, caps] of Object.entries(entries)) {
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
    if (!best || specificity > best.specificity) best = { specificity, caps };
  }
  return best?.caps ?? {};
}

/** Per-attribute maximums produced by the chosen body settings. */
export function computeCaps(ds: Dataset, body: BuildBody): AttributeVector {
  const ref = ds.caps.capModel.referenceBody;
  const overrides = overrideCaps(ds, body);
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

/**
 * Applies cap breakers on top of the builder caps, respecting the per-attribute
 * limit and the absolute ceiling.
 */
export function capsWithBreakers(
  ds: Dataset,
  caps: AttributeVector,
  plan: Record<string, number>
): AttributeVector {
  const cb = ds.capBreakers;
  if (!cb.enabled) return caps;
  const out = { ...caps };
  for (const [attr, count] of Object.entries(plan)) {
    if (count <= 0) continue;
    const used = Math.min(count, cb.maxPerAttribute);
    const base = out[attr];
    if (base === undefined) continue;
    out[attr] = Math.min(cb.absoluteCeiling, base + used * cb.raisePerBreaker);
  }
  return out;
}

export function isCapBreakerEligible(ds: Dataset, attribute: string): boolean {
  const e = ds.capBreakers.eligibility;
  if (e.mode === 'all') return true;
  if (e.mode === 'all-except') return !e.excludedAttributes.includes(attribute);
  return ds.capBreakers.includedAttributes.includes(attribute);
}
