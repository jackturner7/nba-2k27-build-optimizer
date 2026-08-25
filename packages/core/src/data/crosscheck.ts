import type { BadgeDef, Dataset, RequirementClause } from '../types.js';
import { clauseOptions } from '../engine/requirements.js';

/**
 * Diffs the shipped dataset against an independently-produced source.
 *
 * Two sources agreeing is much stronger evidence than either alone, and where
 * they disagree the app should say so rather than quietly picking a winner.
 * Every disagreement has to be recorded in the source file's `knownConflicts`
 * or the cross-check fails — so a conflict can be accepted, but not ignored.
 */

export interface SecondSource {
  sourceName: string;
  retrieved: string;
  covers: string[];
  doesNotCover: string[];
  knownConflicts: {
    badge: string;
    field: string;
    thisSource: unknown;
    dataset: unknown;
    note: string;
  }[];
  badges: Record<string, { height: [number | null, number | null]; tiers: string[] }>;
}

export interface CrossCheckConflict {
  badge: string;
  field: string;
  dataset: string;
  source: string;
  documented: boolean;
  note?: string;
}

export interface CrossCheckReport {
  sourceName: string;
  retrieved: string;
  badgesInBoth: number;
  onlyInDataset: string[];
  onlyInSource: string[];
  tiersCompared: number;
  conflicts: CrossCheckConflict[];
  /** Conflicts the source file does not acknowledge. These are the failures. */
  undocumentedConflicts: CrossCheckConflict[];
  agreementRate: number;
}

/** `'60 driving_layup + 60 strength'` / `'65 close_shot | 65 driving_layup'` -> clauses. */
function parseTier(spec: string): RequirementClause[] {
  const trimmed = spec.trim();
  if (trimmed === '') return [];

  if (trimmed.includes('|')) {
    const anyOf = trimmed.split('|').map(parseAtom);
    return [anyOf.length === 1 ? anyOf[0]! : { anyOf }];
  }
  return trimmed.split('+').map(parseAtom);
}

function parseAtom(atom: string): { attribute: string; min: number } {
  const m = /^\s*(\d+)\s+([a-z_]+)\s*$/.exec(atom);
  if (!m) throw new Error(`Cannot parse requirement "${atom.trim()}". Expected "<rating> <attribute_id>".`);
  return { attribute: m[2]!, min: Number(m[1]) };
}

/** Canonical text for a clause list, so two orderings compare equal. */
function canonical(requires: RequirementClause[]): string {
  return requires
    .map((clause) => {
      const opts = clauseOptions(clause)
        .map((o) => `${o.min} ${o.attribute}`)
        .sort();
      return opts.length > 1 ? `(${opts.join(' | ')})` : opts[0]!;
    })
    .sort()
    .join(' + ');
}

function heightOf(badge: BadgeDef): [number | null, number | null] {
  return [badge.restrictions?.minHeightInches ?? null, badge.restrictions?.maxHeightInches ?? null];
}

export function crossCheckBadges(ds: Dataset, source: SecondSource): CrossCheckReport {
  const byId = new Map(ds.badges.map((b) => [b.id, b]));
  const sourceIds = new Set(Object.keys(source.badges));

  const conflicts: CrossCheckConflict[] = [];
  let tiersCompared = 0;
  let agreements = 0;

  const documented = (badge: string, field: string) =>
    source.knownConflicts.find((c) => c.badge === badge && c.field === field);

  for (const [id, entry] of Object.entries(source.badges)) {
    const badge = byId.get(id);
    if (!badge) continue;

    // Height gates
    const [dsMin, dsMax] = heightOf(badge);
    const [srcMin, srcMax] = entry.height;
    for (const [field, a, b] of [
      ['minHeightInches', dsMin, srcMin],
      ['maxHeightInches', dsMax, srcMax],
    ] as const) {
      if (a === b) {
        agreements++;
        continue;
      }
      const known = documented(id, field);
      conflicts.push({
        badge: id,
        field,
        dataset: String(a),
        source: String(b),
        documented: Boolean(known),
        ...(known ? { note: known.note } : {}),
      });
    }

    // Tier requirements
    for (let i = 0; i < entry.tiers.length; i++) {
      const tier = badge.tiers[i];
      const spec = entry.tiers[i]!;
      tiersCompared++;

      if (!tier) {
        conflicts.push({
          badge: id,
          field: `tier[${i}]`,
          dataset: 'missing',
          source: spec,
          documented: Boolean(documented(id, `tier[${i}]`)),
        });
        continue;
      }

      const dsText = canonical(tier.requires);
      const srcText = canonical(parseTier(spec));
      if (dsText === srcText) {
        agreements++;
        continue;
      }
      const known = documented(id, `tier[${i}]`) ?? documented(id, tier.level);
      conflicts.push({
        badge: id,
        field: tier.level,
        dataset: dsText,
        source: srcText,
        documented: Boolean(known),
        ...(known ? { note: known.note } : {}),
      });
    }
  }

  const total = agreements + conflicts.length;
  return {
    sourceName: source.sourceName,
    retrieved: source.retrieved,
    badgesInBoth: [...sourceIds].filter((id) => byId.has(id)).length,
    onlyInDataset: ds.badges.map((b) => b.id).filter((id) => !sourceIds.has(id)),
    onlyInSource: [...sourceIds].filter((id) => !byId.has(id)),
    tiersCompared,
    conflicts,
    undocumentedConflicts: conflicts.filter((c) => !c.documented),
    agreementRate: total === 0 ? 1 : agreements / total,
  };
}
