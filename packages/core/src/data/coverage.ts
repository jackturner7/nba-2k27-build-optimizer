import type { Dataset } from '../types.js';
import { clauseOptions } from '../engine/requirements.js';

export interface AttributeCoverage {
  attribute: string;
  attributeName: string;
  category: string;
  badgeTiers: number;
  animations: number;
  takeoverTiers: number;
  total: number;
  /** Lowest and highest rating anything asks for on this attribute. */
  lowestThreshold: number | null;
  highestThreshold: number | null;
}

export interface CoverageReport {
  attributes: AttributeCoverage[];
  /** Attributes nothing in the dataset gates on. The optimizer will never buy these. */
  uncovered: AttributeCoverage[];
  /** Attributes with only a token amount of gating. */
  thin: AttributeCoverage[];
}

/**
 * Which attributes the dataset actually gives the optimizer a reason to buy.
 *
 * This matters because the engine is strictly threshold-driven: an attribute
 * that no badge, animation or takeover asks for is worth almost nothing to it,
 * and will sit at the rating floor in every build. That is correct behaviour
 * given the data, and it looks like a bug unless the gap is visible — so the
 * app reports it rather than papering over it with an invented threshold.
 */
export function datasetCoverage(ds: Dataset): CoverageReport {
  const rows = new Map<string, AttributeCoverage>();
  for (const a of ds.attributes) {
    rows.set(a.id, {
      attribute: a.id,
      attributeName: a.name,
      category: a.category,
      badgeTiers: 0,
      animations: 0,
      takeoverTiers: 0,
      total: 0,
      lowestThreshold: null,
      highestThreshold: null,
    });
  }

  const note = (attribute: string, min: number, field: 'badgeTiers' | 'animations' | 'takeoverTiers') => {
    const row = rows.get(attribute);
    if (!row) return;
    row[field]++;
    row.total++;
    row.lowestThreshold = row.lowestThreshold === null ? min : Math.min(row.lowestThreshold, min);
    row.highestThreshold = row.highestThreshold === null ? min : Math.max(row.highestThreshold, min);
  };

  for (const badge of ds.badges) {
    for (const tier of badge.tiers) {
      for (const req of tier.requires.flatMap(clauseOptions)) note(req.attribute, req.min, 'badgeTiers');
    }
  }
  for (const anim of ds.animations) {
    for (const req of anim.requires.flatMap(clauseOptions)) note(req.attribute, req.min, 'animations');
  }
  for (const t of ds.takeovers) {
    for (const tier of t.tiers) {
      for (const req of tier.requires.flatMap(clauseOptions)) note(req.attribute, req.min, 'takeoverTiers');
    }
  }

  const attributes = [...rows.values()].sort((a, b) => a.total - b.total);
  return {
    attributes,
    uncovered: attributes.filter((a) => a.total === 0),
    thin: attributes.filter((a) => a.total > 0 && a.total <= 2),
  };
}
