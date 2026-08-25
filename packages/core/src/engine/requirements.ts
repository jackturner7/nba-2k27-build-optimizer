import type {
  AttributeRequirement,
  AttributeVector,
  BodyRequirement,
  BuildBody,
  Dataset,
} from '../types.js';
import type { CostModel } from './cost.js';

export interface Gap {
  attribute: string;
  attributeName: string;
  current: number;
  required: number;
  deficit: number;
}

export function meetsRequirements(requires: AttributeRequirement[], attrs: AttributeVector): boolean {
  for (const r of requires) {
    if ((attrs[r.attribute] ?? 0) < r.min) return false;
  }
  return true;
}

export function meetsBody(body: BuildBody, req?: BodyRequirement): boolean {
  if (!req) return true;
  if (req.minHeightInches !== undefined && body.heightInches < req.minHeightInches) return false;
  if (req.maxHeightInches !== undefined && body.heightInches > req.maxHeightInches) return false;
  if (req.minWeightPounds !== undefined && body.weightPounds < req.minWeightPounds) return false;
  if (req.maxWeightPounds !== undefined && body.weightPounds > req.maxWeightPounds) return false;
  if (req.minWingspanInches !== undefined && body.wingspanInches < req.minWingspanInches) return false;
  if (req.maxWingspanInches !== undefined && body.wingspanInches > req.maxWingspanInches) return false;
  return true;
}

export function bodyBlockReason(ds: Dataset, body: BuildBody, req?: BodyRequirement): string | undefined {
  if (!req) return undefined;
  const fmt = (n: number) => `${Math.floor(n / 12)}'${n % 12}"`;
  if (req.minHeightInches !== undefined && body.heightInches < req.minHeightInches)
    return `needs at least ${fmt(req.minHeightInches)} of height`;
  if (req.maxHeightInches !== undefined && body.heightInches > req.maxHeightInches)
    return `only available at ${fmt(req.maxHeightInches)} or shorter`;
  if (req.minWeightPounds !== undefined && body.weightPounds < req.minWeightPounds)
    return `needs at least ${req.minWeightPounds} lb`;
  if (req.maxWeightPounds !== undefined && body.weightPounds > req.maxWeightPounds)
    return `only available at ${req.maxWeightPounds} lb or lighter`;
  if (req.minWingspanInches !== undefined && body.wingspanInches < req.minWingspanInches)
    return `needs at least a ${fmt(req.minWingspanInches)} wingspan`;
  if (req.maxWingspanInches !== undefined && body.wingspanInches > req.maxWingspanInches)
    return `only available with a ${fmt(req.maxWingspanInches)} wingspan or shorter`;
  return undefined;
}

export function gapsFor(
  ds: Dataset,
  requires: AttributeRequirement[],
  attrs: AttributeVector
): Gap[] {
  const gaps: Gap[] = [];
  for (const r of requires) {
    const current = attrs[r.attribute] ?? 0;
    if (current >= r.min) continue;
    gaps.push({
      attribute: r.attribute,
      attributeName: attributeName(ds, r.attribute),
      current,
      required: r.min,
      deficit: r.min - current,
    });
  }
  return gaps;
}

/**
 * Build points needed to close every gap. Returns Infinity when a requirement
 * sits above the attribute's cap, which is how the engine prunes unreachable
 * badges instead of chasing them.
 */
export function costToClose(cost: CostModel, gaps: Gap[], caps: AttributeVector): number {
  let total = 0;
  for (const g of gaps) {
    const cap = caps[g.attribute];
    if (cap !== undefined && g.required > cap) return Number.POSITIVE_INFINITY;
    total += cost.cost(g.attribute, g.current, g.required);
  }
  return total;
}

const nameCache = new WeakMap<Dataset, Map<string, string>>();

export function attributeName(ds: Dataset, id: string): string {
  let m = nameCache.get(ds);
  if (!m) {
    m = new Map(ds.attributes.map((a) => [a.id, a.name]));
    nameCache.set(ds, m);
  }
  return m.get(id) ?? id;
}

/** True when every requirement is at or below the attribute's cap. */
export function reachable(requires: AttributeRequirement[], caps: AttributeVector): boolean {
  for (const r of requires) {
    const cap = caps[r.attribute];
    if (cap !== undefined && r.min > cap) return false;
  }
  return true;
}
