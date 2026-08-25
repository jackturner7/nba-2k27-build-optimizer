import type { AttributeVector, Dataset } from '../types.js';

/**
 * Cost lookup with a prefix-sum table per curve, so cost(from -> to) is O(1).
 * The optimizer evaluates this millions of times; a naive loop shows up.
 */
export class CostModel {
  private readonly prefixByCurve = new Map<string, number[]>();
  private readonly curveByAttribute = new Map<string, string>();
  private readonly floor: number;
  private readonly ceiling: number;

  constructor(private readonly ds: Dataset) {
    this.floor = ds.ratingFloor;
    this.ceiling = ds.ratingCeiling;

    for (const curve of ds.costCurves) {
      // prefix[i] = total cost to go from floor to (floor + i)
      const prefix = new Array<number>(this.ceiling - this.floor + 1).fill(0);
      const perPoint = new Array<number>(this.ceiling + 1).fill(0);
      for (const r of curve.ranges) {
        for (let v = r.from; v <= r.to; v++) {
          if (v >= 0 && v <= this.ceiling) perPoint[v] = r.costPerPoint;
        }
      }
      for (let v = this.floor + 1; v <= this.ceiling; v++) {
        prefix[v - this.floor] = prefix[v - this.floor - 1]! + perPoint[v]!;
      }
      this.prefixByCurve.set(curve.id, prefix);
    }

    for (const a of ds.attributes) this.curveByAttribute.set(a.id, a.costCurve);
  }

  /** Build points to move `attribute` from `from` to `to`. Negative if refunding. */
  cost(attribute: string, from: number, to: number): number {
    const curveId = this.curveByAttribute.get(attribute);
    if (!curveId) throw new Error(`Unknown attribute "${attribute}".`);
    const prefix = this.prefixByCurve.get(curveId);
    if (!prefix) throw new Error(`Attribute "${attribute}" references unknown cost curve "${curveId}".`);
    const a = this.clampIndex(from);
    const b = this.clampIndex(to);
    return prefix[b]! - prefix[a]!;
  }

  /** Cost of the single point that takes an attribute from `value - 1` to `value`. */
  pointCost(attribute: string, value: number): number {
    return this.cost(attribute, value - 1, value);
  }

  /** Total spend for a full attribute vector, measured from the rating floor. */
  totalCost(attributes: AttributeVector): number {
    let total = 0;
    for (const a of this.ds.attributes) {
      const v = attributes[a.id];
      if (v === undefined) continue;
      total += this.cost(a.id, this.floor, v);
    }
    return total;
  }

  private clampIndex(value: number): number {
    const v = Math.min(this.ceiling, Math.max(this.floor, Math.round(value)));
    return v - this.floor;
  }
}

const cache = new WeakMap<Dataset, CostModel>();

export function costModelFor(ds: Dataset): CostModel {
  let m = cache.get(ds);
  if (!m) {
    m = new CostModel(ds);
    cache.set(ds, m);
  }
  return m;
}
