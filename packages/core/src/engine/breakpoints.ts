import type { AttributeVector, BuildBody, Dataset, OptimizeRequest } from '../types.js';
import { meetsBody } from './requirements.js';

export interface Breakpoint {
  value: number;
  sources: BreakpointSource[];
}

export interface BreakpointSource {
  kind: 'badge' | 'animation' | 'takeover' | 'minimum' | 'softTarget' | 'dependency' | 'cap' | 'floor';
  id: string;
  label: string;
  /** Rough importance, used to rank which threshold to chase first. */
  weight: number;
}

export type BreakpointMap = Record<string, Breakpoint[]>;

/**
 * The whole reason this optimizer beats "just max everything": for each
 * attribute, only a handful of ratings actually change anything. Everything
 * between two thresholds is identical in gameplay terms and differs only in
 * cost, so the search only ever considers threshold values (plus the floor and
 * the cap).
 *
 * This is what lets the engine notice that 89 Three-Point is worth more than 90
 * when 89 is the last threshold that unlocks something.
 */
export function collectBreakpoints(
  ds: Dataset,
  body: BuildBody,
  caps: AttributeVector,
  request: Pick<OptimizeRequest, 'minimums' | 'softTargets' | 'maximums'>
): BreakpointMap {
  const map = new Map<string, Map<number, BreakpointSource[]>>();
  for (const a of ds.attributes) map.set(a.id, new Map());

  const add = (attribute: string, value: number, source: BreakpointSource) => {
    const cap = caps[attribute];
    if (cap === undefined) return;
    const v = Math.round(value);
    if (v <= ds.ratingFloor || v > cap) return;
    const max = request.maximums?.[attribute];
    if (max !== undefined && v > max) return;
    const byValue = map.get(attribute);
    if (!byValue) return;
    const list = byValue.get(v) ?? [];
    list.push(source);
    byValue.set(v, list);
  };

  for (const badge of ds.badges) {
    if (badge.restrictions) {
      if (!meetsBody(body, badge.restrictions)) continue;
      if (badge.restrictions.positions && !badge.restrictions.positions.includes(body.position)) continue;
    }
    for (const tier of badge.tiers) {
      const levelWeight = ds.badgeLevels.find((l) => l.id === tier.level)?.scoreWeight ?? 1;
      for (const req of tier.requires) {
        add(req.attribute, req.min, {
          kind: 'badge',
          id: `${badge.id}:${tier.level}`,
          label: `${badge.name} (${ds.badgeLevels.find((l) => l.id === tier.level)?.name ?? tier.level})`,
          weight: levelWeight * badge.impact,
        });
      }
    }
  }

  for (const anim of ds.animations) {
    if (!meetsBody(body, anim.bodyRequires)) continue;
    for (const req of anim.requires) {
      add(req.attribute, req.min, {
        kind: 'animation',
        id: anim.id,
        label: anim.name,
        weight: anim.impact * 1.5,
      });
    }
  }

  for (const t of ds.takeovers) {
    for (const tier of t.tiers) {
      for (const req of tier.requires) {
        add(req.attribute, req.min, {
          kind: 'takeover',
          id: `${t.id}:${tier.id}`,
          label: `${t.name} — ${tier.name}`,
          weight: t.impact * 2,
        });
      }
    }
  }

  for (const dep of ds.dependencies) {
    if (!dep.enabled) continue;
    if (dep.kind === 'diminishing' && dep.sourceMin !== undefined) {
      add(dep.source, dep.sourceMin, {
        kind: 'dependency',
        id: dep.id,
        label: dep.note ?? `Supports ${dep.target}`,
        weight: 2,
      });
    }
    if (dep.kind === 'hard-min' && dep.min !== undefined) {
      add(dep.target, dep.min, { kind: 'dependency', id: dep.id, label: dep.note ?? dep.id, weight: 3 });
    }
  }

  for (const [attr, min] of Object.entries(request.minimums ?? {})) {
    if (min === undefined) continue;
    add(attr, min, { kind: 'minimum', id: attr, label: `Requested minimum ${min}`, weight: 50 });
  }
  for (const [attr, target] of Object.entries(request.softTargets ?? {})) {
    if (target === undefined) continue;
    add(attr, target, { kind: 'softTarget', id: attr, label: `Requested target ${target}`, weight: 10 });
  }

  // Floor and cap are always candidates: the floor is "spend nothing here" and
  // the cap is "this is a maxed attribute, nothing more to buy".
  const out: BreakpointMap = {};
  for (const a of ds.attributes) {
    const byValue = map.get(a.id)!;
    const cap = Math.min(caps[a.id] ?? ds.ratingFloor, request.maximums?.[a.id] ?? ds.ratingCeiling);
    const values = new Map(byValue);
    if (!values.has(ds.ratingFloor)) values.set(ds.ratingFloor, [{ kind: 'floor', id: a.id, label: 'Unspent', weight: 0 }]);
    if (cap > ds.ratingFloor && !values.has(cap)) {
      values.set(cap, [{ kind: 'cap', id: a.id, label: `Cap for this body (${cap})`, weight: 0 }]);
    }
    out[a.id] = [...values.entries()]
      .filter(([v]) => v >= ds.ratingFloor && v <= cap)
      .sort((x, y) => x[0] - y[0])
      .map(([value, sources]) => ({ value, sources }));
  }
  return out;
}

/**
 * The highest breakpoint at or below `value` — i.e. the last rating that
 * actually did something. Points above it are the definition of waste.
 */
export function lastUsefulBreakpoint(breakpoints: Breakpoint[], value: number): number {
  let last = breakpoints[0]?.value ?? value;
  for (const bp of breakpoints) {
    if (bp.value > value) break;
    if (bp.sources.some((s) => s.kind !== 'cap' && s.kind !== 'floor')) last = bp.value;
  }
  return last;
}
