import type {
  AttributeRequirement,
  AttributeVector,
  BodyRequirement,
  BuildBody,
  Dataset,
  RequirementClause,
} from '../types.js';
import type { CostModel } from './cost.js';

export interface Gap {
  attribute: string;
  attributeName: string;
  current: number;
  required: number;
  deficit: number;
  /** True when this gap is one branch of an "any of" clause, i.e. there was a choice. */
  fromChoice?: boolean;
}

/**
 * 2K27 requirements are conjunctive normal form: a list of clauses that must all
 * hold, where a clause is either a single attribute minimum or an "any of" set
 * where satisfying one branch is enough.
 *
 * Deadeye Bronze ("65 Mid-Range OR 65 Three-Point") is one anyOf clause.
 * Posterizer Bronze ("73 Driving Dunk AND 65 Vertical") is two single clauses.
 */
export function clauseOptions(clause: RequirementClause): AttributeRequirement[] {
  return 'anyOf' in clause ? clause.anyOf : [clause];
}

export function isChoice(clause: RequirementClause): boolean {
  return 'anyOf' in clause && clause.anyOf.length > 1;
}

/** Every attribute mentioned anywhere in a requirement list. */
export function requirementAttributes(requires: RequirementClause[]): string[] {
  const out = new Set<string>();
  for (const clause of requires) {
    for (const option of clauseOptions(clause)) out.add(option.attribute);
  }
  return [...out];
}

/**
 * Attributes that must ALL be raised for this requirement to be met — the
 * single-option clauses. An "any of" clause contributes nothing here because
 * there is a choice about which attribute pays for it.
 */
export function mandatoryAttributes(requires: RequirementClause[]): string[] {
  const out = new Set<string>();
  for (const clause of requires) {
    const options = clauseOptions(clause);
    if (options.length === 1 && options[0]) out.add(options[0].attribute);
  }
  return [...out];
}

export function meetsRequirements(requires: RequirementClause[], attrs: AttributeVector): boolean {
  for (const clause of requires) {
    let satisfied = false;
    for (const option of clauseOptions(clause)) {
      if ((attrs[option.attribute] ?? 0) >= option.min) {
        satisfied = true;
        break;
      }
    }
    if (!satisfied) return false;
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

export function bodyBlockReason(_ds: Dataset, body: BuildBody, req?: BodyRequirement): string | undefined {
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

/**
 * What is still missing. For an "any of" clause this reports only the CHEAPEST
 * unmet branch, because the player only has to buy one of them — reporting both
 * would double-count the price of the badge.
 */
export function gapsFor(
  ds: Dataset,
  requires: RequirementClause[],
  attrs: AttributeVector,
  cost?: CostModel,
  caps?: AttributeVector
): Gap[] {
  const gaps: Gap[] = [];

  for (const clause of requires) {
    const options = clauseOptions(clause);
    if (options.length === 0) continue;

    const satisfied = options.some((o) => (attrs[o.attribute] ?? 0) >= o.min);
    if (satisfied) continue;

    let best: { option: AttributeRequirement; price: number } | null = null;
    for (const option of options) {
      const cap = caps?.[option.attribute];
      if (cap !== undefined && option.min > cap) continue; // this branch is unreachable on this body
      const current = attrs[option.attribute] ?? 0;
      const price = cost ? cost.cost(option.attribute, current, option.min) : option.min - current;
      if (!best || price < best.price) best = { option, price };
    }
    // Every branch is over the cap: report the cheapest one anyway so the user
    // can see what the badge wanted.
    if (!best) {
      const fallback = options.reduce((a, b) => (a.min <= b.min ? a : b));
      best = { option: fallback, price: Number.POSITIVE_INFINITY };
    }

    const current = attrs[best.option.attribute] ?? 0;
    gaps.push({
      attribute: best.option.attribute,
      attributeName: attributeName(ds, best.option.attribute),
      current,
      required: best.option.min,
      deficit: best.option.min - current,
      ...(options.length > 1 ? { fromChoice: true } : {}),
    });
  }

  return gaps;
}

/**
 * Build points needed to close every gap. Infinity when no branch of some clause
 * is reachable under the caps — which is how the engine prunes badges it can
 * never get instead of chasing them.
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

/** True when at least one branch of every clause sits at or below its cap. */
export function reachable(requires: RequirementClause[], caps: AttributeVector): boolean {
  for (const clause of requires) {
    const options = clauseOptions(clause);
    if (options.length === 0) continue;
    const any = options.some((o) => {
      const cap = caps[o.attribute];
      return cap === undefined || o.min <= cap;
    });
    if (!any) return false;
  }
  return true;
}

/** Human-readable requirement text, e.g. "65 Mid-Range Shot or 65 Three-Point Shot". */
export function describeRequirements(ds: Dataset, requires: RequirementClause[]): string {
  if (requires.length === 0) return 'No attribute requirement';
  return requires
    .map((clause) =>
      clauseOptions(clause)
        .map((o) => `${o.min} ${attributeName(ds, o.attribute)}`)
        .join(' or ')
    )
    .join(' and ');
}
