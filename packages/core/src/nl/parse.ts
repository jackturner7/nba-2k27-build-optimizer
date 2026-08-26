import { parseHeight, formatHeight, heightRange, weightRange, wingspanRange } from '../engine/body.js';
import { computeCaps } from '../engine/caps.js';
import { clauseOptions } from '../engine/requirements.js';
import type { BuildBody, Dataset, OptimizeRequest, PositionId } from '../types.js';
import { INTENSITY_WORDS, POSITION_ALIASES, aliasIndex } from './aliases.js';

export interface ParseNote {
  kind: 'body' | 'position' | 'minimum' | 'target' | 'priority' | 'animation' | 'warning';
  message: string;
}

export interface ParsedBuildRequest {
  request: OptimizeRequest;
  notes: ParseNote[];
  /** Fragments the parser could not interpret, echoed so the user can rephrase. */
  unparsed: string[];
  /** True when the parser had to guess a body because none was stated. */
  bodyInferred: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
};

/**
 * Turns a sentence like
 *   "6'8 wing with the highest three-point rating possible, elite perimeter
 *    defense, at least 85 steal, good driving dunk and enough ball handle for
 *    good dribble animations"
 * into a structured OptimizeRequest.
 *
 * Deliberately rule-based, not a model: the user needs to see exactly which
 * phrase produced which constraint, and be able to correct it.
 */
export function parseBuildRequest(ds: Dataset, input: string): ParsedBuildRequest {
  const notes: ParseNote[] = [];
  const unparsed: string[] = [];
  const text = normalise(input);
  const idx = aliasIndex(ds);

  // --- Position -------------------------------------------------------------
  let position: PositionId | null = null;
  let positionPhrase = '';
  for (const [id, aliases] of Object.entries(POSITION_ALIASES)) {
    if (!ds.positions.some((p) => p.id === id)) continue;
    for (const alias of aliases) {
      if (matchesWord(text, alias) && alias.length > positionPhrase.length) {
        position = id;
        positionPhrase = alias;
      }
    }
  }

  // --- Height / weight / wingspan ------------------------------------------
  const wingspanMatch = text.match(/(\d\s*(?:'|-|ft|foot|feet)\s*\d{1,2}|\d{2,3}\s*(?:inch|inches|in)\b)[^.]{0,20}wingspan/);
  const wingspanFirst = text.match(/wingspan\s*(?:of|at|:)?\s*(\d\s*(?:'|-|ft|foot|feet)\s*\d{1,2}|\d{2,3}\s*(?:inch|inches|in)\b)/);
  const wingspanInches = parseHeight(stripUnits(wingspanMatch?.[1] ?? wingspanFirst?.[1] ?? ''));

  let heightInches: number | null = null;
  const heightCandidates = [...text.matchAll(/(\d)\s*(?:'|’|-|ft\.?|foot|feet)\s*(\d{1,2})?/g)];
  for (const m of heightCandidates) {
    const raw = `${m[1]}'${m[2] ?? 0}`;
    const parsed = parseHeight(raw);
    if (parsed === null) continue;
    // Don't mistake the wingspan for the height.
    if (wingspanInches !== null && parsed === wingspanInches && heightCandidates.length > 1) continue;
    heightInches = parsed;
    break;
  }
  if (heightInches === null) {
    const worded = text.match(/(five|six|seven)[\s-](?:foot|feet|ft)[\s-]?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|\d{1,2})?/);
    if (worded) {
      const feet = { five: 5, six: 6, seven: 7 }[worded[1] as 'five' | 'six' | 'seven'];
      const inchWord = worded[2];
      const inches = inchWord ? (NUMBER_WORDS[inchWord] ?? Number(inchWord) ?? 0) : 0;
      if (feet) heightInches = feet * 12 + (Number.isFinite(inches) ? inches : 0);
    }
  }

  const weightMatch = text.match(/(\d{2,3})\s*(?:lb|lbs|pound|pounds)\b/);
  const weightPounds = weightMatch ? Number(weightMatch[1]) : null;

  // --- Position / height reconciliation ------------------------------------
  if (!position && heightInches !== null) {
    const fits = ds.positions.filter((p) => heightInches! >= p.heightInchesMin && heightInches! <= p.heightInchesMax);
    // Prefer the position whose range centres closest to the stated height.
    position = fits.sort((a, b) => {
      const ca = Math.abs((a.heightInchesMin + a.heightInchesMax) / 2 - heightInches!);
      const cb = Math.abs((b.heightInchesMin + b.heightInchesMax) / 2 - heightInches!);
      return ca - cb;
    })[0]?.id ?? null;
    if (position) {
      notes.push({ kind: 'position', message: `No position given, so ${formatHeight(heightInches)} was read as a ${nameOfPosition(ds, position)}.` });
    }
  }
  if (!position) {
    position = ds.positions[Math.floor(ds.positions.length / 2)]?.id ?? ds.positions[0]!.id;
    notes.push({ kind: 'warning', message: `No position or height found, defaulting to ${nameOfPosition(ds, position)}.` });
  }

  const hRange = heightRange(ds, position);
  let bodyInferred = false;
  if (heightInches === null) {
    heightInches = Math.round((hRange.min + hRange.max) / 2);
    bodyInferred = true;
    notes.push({ kind: 'body', message: `No height given, using the middle of the ${nameOfPosition(ds, position)} range (${formatHeight(heightInches)}).` });
  } else if (heightInches < hRange.min || heightInches > hRange.max) {
    notes.push({
      kind: 'warning',
      message: `${formatHeight(heightInches)} is outside the ${nameOfPosition(ds, position)} range (${formatHeight(hRange.min)}–${formatHeight(hRange.max)}); it was clamped.`,
    });
    heightInches = Math.min(hRange.max, Math.max(hRange.min, heightInches));
  }

  const wRange = weightRange(ds, position, heightInches);
  const wsRange = wingspanRange(ds, position, heightInches);
  const body: BuildBody = {
    position,
    heightInches,
    weightPounds: weightPounds ?? Math.round((wRange.min + wRange.max) / 2),
    wingspanInches: wingspanInches ?? Math.min(wsRange.max, heightInches + 5),
  };
  if (weightPounds === null) {
    bodyInferred = true;
    notes.push({ kind: 'body', message: `No weight given, starting at ${body.weightPounds} lb (mid-range for this height).` });
  }
  if (wingspanInches === null) {
    bodyInferred = true;
    notes.push({ kind: 'body', message: `No wingspan given, starting at ${formatHeight(body.wingspanInches)}.` });
  }
  body.weightPounds = Math.min(wRange.max, Math.max(wRange.min, body.weightPounds));
  body.wingspanInches = Math.min(wsRange.max, Math.max(wsRange.min, body.wingspanInches));

  const caps = computeCaps(ds, body);

  // --- Clause-by-clause constraint extraction ------------------------------
  const priorities: Record<string, number> = {};
  const minimums: Record<string, number> = {};
  const softTargets: Record<string, number> = {};

  const clauses = text
    .split(/(?:,|\band\b|\bwith\b|\bplus\b|\bbut\b|;|\.)/)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    let handled = false;

    // "at least 85 steal" / "85+ steal" / "steal of at least 85" / "minimum 85 steal"
    const attr = findAttribute(idx, clause);

    const explicitMin =
      clause.match(/(?:at least|minimum(?: of)?|min|no less than)\s*(\d{2})/) ??
      clause.match(/(\d{2})\s*\+/) ??
      clause.match(/(\d{2})\s*(?:or (?:higher|better|more|above))/);

    const explicitMax = clause.match(/(?:at most|no more than|max(?:imum)? of|cap(?:ped)? at)\s*(\d{2})/);

    if (attr && explicitMin) {
      const value = clampRating(ds, Number(explicitMin[1]));
      const cap = caps[attr.attribute] ?? ds.ratingCeiling;
      minimums[attr.attribute] = Math.min(value, ds.ratingCeiling);
      priorities[groupForAttribute(ds, attr.attribute)] = Math.max(priorities[groupForAttribute(ds, attr.attribute)] ?? 0, 80);
      if (value > cap) {
        notes.push({
          kind: 'warning',
          message: `${nameOfAttribute(ds, attr.attribute)} ${value} is above the ${cap} cap for this body — the optimizer will report this as infeasible rather than quietly lowering it.`,
        });
      } else {
        notes.push({ kind: 'minimum', message: `Hard floor: ${nameOfAttribute(ds, attr.attribute)} ≥ ${value}.` });
      }
      handled = true;
    } else if (attr && explicitMax) {
      const value = clampRating(ds, Number(explicitMax[1]));
      softTargets[attr.attribute] = value;
      notes.push({ kind: 'target', message: `Ceiling requested: ${nameOfAttribute(ds, attr.attribute)} around ${value}.` });
      handled = true;
    }

    // "enough ball handle for good dribble animations"
    const enoughFor = clause.match(/(?:enough|sufficient)\s+(.+?)\s+(?:for|to (?:get|unlock|hit))\s+(.+)/);
    if (!handled && enoughFor) {
      const targetAttr = findAttribute(idx, enoughFor[1] ?? '');
      if (targetAttr) {
        const goal = enoughFor[2] ?? '';
        const threshold = animationThresholdFor(ds, targetAttr.attribute, goal, caps);
        if (threshold) {
          softTargets[targetAttr.attribute] = threshold.value;
          priorities[groupForAttribute(ds, targetAttr.attribute)] = Math.max(
            priorities[groupForAttribute(ds, targetAttr.attribute)] ?? 0,
            55
          );
          notes.push({
            kind: 'animation',
            message: `"${enoughFor[0]}" → ${nameOfAttribute(ds, targetAttr.attribute)} ${threshold.value}, the requirement for ${threshold.label}.`,
          });
          handled = true;
        } else {
          notes.push({
            kind: 'warning',
            message: `Could not find an animation matching "${goal}" that depends on ${nameOfAttribute(ds, targetAttr.attribute)}. Treating it as a moderate priority instead.`,
          });
          priorities[groupForAttribute(ds, targetAttr.attribute)] = Math.max(priorities[groupForAttribute(ds, targetAttr.attribute)] ?? 0, 55);
          handled = true;
        }
      }
    }

    // "highest three-point rating possible" / "elite perimeter defense" / "good driving dunk"
    if (!handled) {
      const intensity = findIntensity(clause);
      const group = findGroup(idx, clause);
      if (attr && intensity !== null) {
        const g = groupForAttribute(ds, attr.attribute);
        priorities[g] = Math.max(priorities[g] ?? 0, intensity);
        if (intensity >= 100) {
          softTargets[attr.attribute] = caps[attr.attribute] ?? ds.ratingCeiling;
          notes.push({
            kind: 'priority',
            message: `"${clause.trim()}" → push ${nameOfAttribute(ds, attr.attribute)} as high as the body allows (cap ${caps[attr.attribute] ?? '?'}).`,
          });
        } else {
          notes.push({ kind: 'priority', message: `"${clause.trim()}" → ${nameOfAttribute(ds, attr.attribute)} priority ${intensity}.` });
        }
        handled = true;
      } else if (group && intensity !== null) {
        priorities[group.group] = Math.max(priorities[group.group] ?? 0, intensity);
        notes.push({ kind: 'priority', message: `"${clause.trim()}" → ${nameOfGroup(ds, group.group)} priority ${intensity}.` });
        handled = true;
      } else if (attr) {
        const g = groupForAttribute(ds, attr.attribute);
        priorities[g] = Math.max(priorities[g] ?? 0, 60);
        notes.push({ kind: 'priority', message: `"${clause.trim()}" → ${nameOfAttribute(ds, attr.attribute)} priority 60 (no strength word found).` });
        handled = true;
      } else if (group) {
        priorities[group.group] = Math.max(priorities[group.group] ?? 0, 60);
        notes.push({ kind: 'priority', message: `"${clause.trim()}" → ${nameOfGroup(ds, group.group)} priority 60.` });
        handled = true;
      }
    }

    if (!handled && !isBodyClause(clause, positionPhrase)) {
      unparsed.push(clause.trim());
    }
  }

  if (Object.keys(priorities).length === 0) {
    notes.push({ kind: 'warning', message: 'No priorities were recognised. Falling back to a balanced weighting.' });
    for (const g of ds.priorityGroups) priorities[g.id] = 50;
  }

  const request: OptimizeRequest = {
    body,
    priorities,
    minimums,
    softTargets,
    resultCount: 3,
    useCapBreakers: true,
    useBadgeBoosts: true,
  };

  return { request, notes, unparsed, bodyInferred };
}

// ---------------------------------------------------------------------------

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[”″]/g, '"')
    .replace(/[’′]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripUnits(s: string): string {
  return s.replace(/\s*(?:inch|inches|in)\b/, '').trim();
}

function matchesWord(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`).test(text);
}

function findAttribute(idx: ReturnType<typeof aliasIndex>, clause: string): { attribute: string; phrase: string } | null {
  for (const entry of idx.attributePhrases) {
    if (matchesWord(clause, entry.phrase)) return { attribute: entry.attribute, phrase: entry.phrase };
  }
  return null;
}

function findGroup(idx: ReturnType<typeof aliasIndex>, clause: string): { group: string; phrase: string } | null {
  for (const entry of idx.groupPhrases) {
    if (matchesWord(clause, entry.phrase)) return { group: entry.group, phrase: entry.phrase };
  }
  return null;
}

function findIntensity(clause: string): number | null {
  for (const entry of INTENSITY_WORDS) {
    for (const word of entry.words) {
      if (clause.includes(word)) return entry.weight;
    }
  }
  return null;
}

function isBodyClause(clause: string, positionPhrase: string): boolean {
  if (positionPhrase && clause.includes(positionPhrase)) return true;
  return /\d\s*'|wingspan|lb|pound|i want|i'd like|build|create|make me|looking for/.test(clause);
}

function clampRating(ds: Dataset, value: number): number {
  return Math.max(ds.ratingFloor, Math.min(ds.ratingCeiling, Math.round(value)));
}

function nameOfAttribute(ds: Dataset, id: string): string {
  return ds.attributes.find((a) => a.id === id)?.name ?? id;
}

function nameOfGroup(ds: Dataset, id: string): string {
  return ds.priorityGroups.find((g) => g.id === id)?.name ?? id;
}

function nameOfPosition(ds: Dataset, id: string): string {
  return ds.positions.find((p) => p.id === id)?.name ?? id;
}

/** The priority group that most directly owns an attribute. */
function groupForAttribute(ds: Dataset, attribute: string): string {
  const direct = ds.priorityGroups.find((g) => g.attributes.includes(attribute) && g.attributes.length === 1);
  if (direct) return direct.id;
  const any = ds.priorityGroups.find((g) => g.attributes.includes(attribute));
  if (any) return any.id;
  const supporting = ds.priorityGroups.find((g) => g.supporting.includes(attribute));
  return supporting?.id ?? ds.priorityGroups[0]?.id ?? attribute;
}

/**
 * Resolves "good dribble animations" into an actual rating, straight from the
 * animations dataset — so when the data is replaced, the parser's answers move
 * with it instead of staying frozen at a number baked into the code.
 */
function animationThresholdFor(
  ds: Dataset,
  attribute: string,
  goalPhrase: string,
  caps: Record<string, number>
): { value: number; label: string } | null {
  const cap = caps[attribute] ?? ds.ratingCeiling;
  const words = goalPhrase.split(/\s+/).filter((w) => w.length > 2);

  const relevant = ds.animations
    .map((anim) => {
      // Only the branch that mentions this attribute matters; for an "any of"
      // requirement the other branches are alternative ways to get the same
      // animation and say nothing about what THIS attribute needs to be.
      const req = anim.requires
        .flatMap(clauseOptions)
        .filter((r) => r.attribute === attribute)
        .sort((a, b) => a.min - b.min)[0];
      if (!req || req.min > cap) return null;
      const category = ds.animationCategories.find((c) => c.id === anim.category);
      const haystack = `${anim.name} ${category?.name ?? ''} ${category?.description ?? ''} ${anim.category}`.toLowerCase();
      const score = words.reduce((acc, w) => acc + (haystack.includes(w.replace(/s$/, '')) ? 1 : 0), 0);
      return { anim, min: req.min, score };
    })
    .filter((x): x is { anim: Dataset['animations'][number]; min: number; score: number } => x !== null)
    .filter((x) => x.score > 0)
    .sort((a, b) => a.min - b.min);

  if (relevant.length === 0) return null;

  const intensity = findIntensity(goalPhrase) ?? 68;
  // Map the strength word onto a position in the ladder of matching animations.
  const index =
    intensity >= 100
      ? relevant.length - 1
      : Math.min(relevant.length - 1, Math.max(0, Math.round(((intensity - 30) / 70) * (relevant.length - 1))));
  const chosen = relevant[index]!;
  return { value: chosen.min, label: chosen.anim.name };
}
