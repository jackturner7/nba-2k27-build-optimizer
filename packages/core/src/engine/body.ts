import type { BuildBody, Dataset, PositionId } from '../types.js';

export interface Range {
  min: number;
  max: number;
}

export function formatHeight(totalInches: number): string {
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
}

export function parseHeight(input: string): number | null {
  const cleaned = input.trim().replace(/[”″]/g, '"').replace(/[’′]/g, "'");
  // 6'8", 6'8, 6-8, 6ft8, 6 8
  const m = cleaned.match(/^(\d)\s*(?:'|-|ft|foot|feet|\s)\s*(\d{1,2})\s*(?:"|in|inch|inches)?$/i);
  if (m) return Number(m[1]) * 12 + Number(m[2]);
  const feetOnly = cleaned.match(/^(\d)\s*(?:'|ft|foot|feet)$/i);
  if (feetOnly) return Number(feetOnly[1]) * 12;
  const inchesOnly = cleaned.match(/^(\d{2,3})\s*(?:"|in|inches)?$/);
  if (inchesOnly) {
    const n = Number(inchesOnly[1]);
    if (n >= 60 && n <= 100) return n;
  }
  return null;
}

export function getPosition(ds: Dataset, id: PositionId) {
  const pos = ds.positions.find((p) => p.id === id);
  if (!pos) throw new Error(`Unknown position "${id}".`);
  return pos;
}

export function heightRange(ds: Dataset, position: PositionId): Range {
  const pos = getPosition(ds, position);
  return {
    min: Math.max(pos.heightInchesMin, ds.body.heightInchesMin),
    max: Math.min(pos.heightInchesMax, ds.body.heightInchesMax),
  };
}

function overrideKey(position: PositionId, heightInches: number): string {
  return `${position}:${heightInches}`;
}

export function weightRange(ds: Dataset, position: PositionId, heightInches: number): Range {
  const override = ds.body.overrides[overrideKey(position, heightInches)];
  const m = ds.body.weightModel;
  const delta = heightInches - m.referenceHeightInches;
  let min = Math.round(m.minWeightAtReference + m.minWeightPerInch * delta);
  let max = Math.round(m.maxWeightAtReference + m.maxWeightPerInch * delta);
  if (override?.weightMin !== undefined) min = override.weightMin;
  if (override?.weightMax !== undefined) max = override.weightMax;
  min = Math.max(min, m.absoluteMin);
  max = Math.min(max, m.absoluteMax);
  if (min > max) min = max;
  return { min, max };
}

export function wingspanRange(
  ds: Dataset,
  position: PositionId,
  heightInches: number,
  weightPounds?: number
): Range {
  const override = ds.body.overrides[overrideKey(position, heightInches)];
  const m = ds.body.wingspanModel;
  let min = heightInches + m.minOffsetInches;
  let max = heightInches + m.maxOffsetInches;
  if (override?.wingspanMin !== undefined) min = override.wingspanMin;
  if (override?.wingspanMax !== undefined) max = override.wingspanMax;

  // Declared body interaction rules (empty by default — see body.json).
  for (const rule of ds.body.interactions.rules) {
    if (!matchesBody(rule.when, { heightInches, weightPounds })) continue;
    if (rule.clamp.maxWingspanInches !== undefined) max = Math.min(max, rule.clamp.maxWingspanInches);
    if (rule.clamp.minWingspanInches !== undefined) min = Math.max(min, rule.clamp.minWingspanInches);
  }

  min = Math.max(min, m.absoluteMinInches);
  max = Math.min(max, m.absoluteMaxInches);
  if (min > max) min = max;
  return { min, max };
}

function matchesBody(
  when: { minHeightInches?: number; maxHeightInches?: number; minWeightPounds?: number; maxWeightPounds?: number },
  body: { heightInches: number; weightPounds?: number }
): boolean {
  if (when.minHeightInches !== undefined && body.heightInches < when.minHeightInches) return false;
  if (when.maxHeightInches !== undefined && body.heightInches > when.maxHeightInches) return false;
  if (body.weightPounds !== undefined) {
    if (when.minWeightPounds !== undefined && body.weightPounds < when.minWeightPounds) return false;
    if (when.maxWeightPounds !== undefined && body.weightPounds > when.maxWeightPounds) return false;
  }
  return true;
}

export interface BodyValidation {
  valid: boolean;
  errors: string[];
  corrected: BuildBody;
  ranges: { height: Range; weight: Range; wingspan: Range };
}

/**
 * Validates a body against the dataset's legality rules and returns the nearest
 * legal body, so the UI can clamp sliders instead of rejecting input.
 */
export function validateBody(ds: Dataset, body: BuildBody): BodyValidation {
  const errors: string[] = [];
  const hRange = heightRange(ds, body.position);
  const height = clamp(Math.round(body.heightInches), hRange.min, hRange.max);
  if (height !== body.heightInches) {
    errors.push(
      `${formatHeight(body.heightInches)} is outside the ${body.position} range (${formatHeight(hRange.min)}-${formatHeight(hRange.max)}).`
    );
  }

  const wRange = weightRange(ds, body.position, height);
  const weight = clamp(Math.round(body.weightPounds), wRange.min, wRange.max);
  if (weight !== body.weightPounds) {
    errors.push(`${body.weightPounds} lb is outside the legal range at ${formatHeight(height)} (${wRange.min}-${wRange.max} lb).`);
  }

  const wsRange = wingspanRange(ds, body.position, height, weight);
  const wingspan = clamp(Math.round(body.wingspanInches), wsRange.min, wsRange.max);
  if (wingspan !== body.wingspanInches) {
    errors.push(
      `${formatHeight(body.wingspanInches)} wingspan is outside the legal range at ${formatHeight(height)} (${formatHeight(wsRange.min)}-${formatHeight(wsRange.max)}).`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    corrected: { position: body.position, heightInches: height, weightPounds: weight, wingspanInches: wingspan },
    ranges: { height: hRange, weight: wRange, wingspan: wsRange },
  };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
