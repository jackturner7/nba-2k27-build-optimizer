import { describe, expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/node-loader.js';
import { verificationReport } from '../data/loader.js';
import { datasetCoverage } from '../data/coverage.js';
import { collectBreakpoints, lastUsefulBreakpoint } from '../engine/breakpoints.js';
import { computeBudget, computeCaps } from '../engine/caps.js';
import { costModelFor } from '../engine/cost.js';
import { evaluateBuild } from '../engine/evaluate.js';
import { optimize } from '../engine/optimize.js';
import { requestFromArchetype } from '../engine/archetype.js';
import { formatHeight, parseHeight, validateBody } from '../engine/body.js';
import { clauseOptions, gapsFor, meetsRequirements } from '../engine/requirements.js';
import { computeTokens } from '../engine/tokens.js';
import { parseBuildRequest } from '../nl/parse.js';
import type { BuildBody } from '../types.js';

const { dataset: ds, issues } = loadDatasetFromDisk('2k27');

const WING: BuildBody = { position: 'SF', heightInches: 80, weightPounds: 215, wingspanInches: 85 };

describe('dataset', () => {
  it('loads with no structural errors', () => {
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.map((e) => `${e.file}: ${e.message}`)).toEqual([]);
  });

  it('is honest about what is and is not sourced', () => {
    const report = verificationReport(ds);
    expect(report.totalRecords).toBeGreaterThan(0);
    // Nothing may claim 'verified' — that status is reserved for values read
    // straight off the shipped builder, which nobody here has done.
    expect(report.byStatus['verified'] ?? 0).toBe(0);
    expect(ds.meta.provenance.status).toBe('partial');
    // The files that are still guesses must still say so.
    expect(ds.budget.verification.status).toBe('unverified');
    expect(ds.costCurves.every((c) => c.verification.status === 'unverified')).toBe(true);
  });

  it('has the 2K27 attribute set, not the 2K26 one', () => {
    const ids = new Set(ds.attributes.map((a) => a.id));
    // Stamina is not in the 2K27 builder — it is raised at the in-game gym.
    expect(ids.has('stamina')).toBe(false);
    // 2K27 badges require Agility; Acceleration does not appear anywhere.
    expect(ids.has('acceleration')).toBe(false);
    expect(ids.has('agility')).toBe(true);
    // Six badge disciplines, with Rebounding split out of Defense.
    expect(ds.categories.map((c) => c.id).sort()).toEqual(
      ['defense', 'finishing', 'physicals', 'playmaking', 'rebounding', 'shooting']
    );
  });

  it('uses the four 2K27 badge tiers', () => {
    expect(ds.badgeLevels.map((l) => l.id)).toEqual(['bronze', 'silver', 'gold', 'hof']);
  });

  it('every badge tier is reachable in principle', () => {
    for (const badge of ds.badges) {
      for (const tier of badge.tiers) {
        for (const req of tier.requires.flatMap(clauseOptions)) {
          expect(req.min).toBeLessThanOrEqual(ds.ratingCeiling);
          expect(req.min).toBeGreaterThanOrEqual(ds.ratingFloor);
        }
      }
    }
  });
});

describe('coverage report', () => {
  it('flags attributes nothing gates on', () => {
    const coverage = datasetCoverage(ds);
    expect(coverage.attributes.length).toBe(ds.attributes.length);
    // An uncovered attribute is a data gap, and it must be reported rather than
    // hidden — the optimizer will leave it at the floor in every build.
    for (const a of coverage.uncovered) {
      expect(a.total).toBe(0);
      expect(a.lowestThreshold).toBeNull();
    }
    for (const a of coverage.attributes) {
      if (a.total > 0) {
        expect(a.lowestThreshold).not.toBeNull();
        expect(a.highestThreshold!).toBeGreaterThanOrEqual(a.lowestThreshold!);
      }
    }
  });

  it('an uncovered attribute really does stay at the floor', () => {
    const coverage = datasetCoverage(ds);
    const uncovered = coverage.uncovered[0];
    if (!uncovered) return; // dataset is fully covered; nothing to assert
    const build = optimize(ds, requestFromArchetype(ds, 'two_way_guard')).builds[0]!;
    expect(build.attributes[uncovered.attribute]).toBe(ds.ratingFloor);
  });
});

describe('body rules', () => {
  it('round-trips heights', () => {
    expect(parseHeight("6'8")).toBe(80);
    expect(parseHeight('6\'8"')).toBe(80);
    expect(parseHeight('6-8')).toBe(80);
    expect(formatHeight(80)).toBe("6'8\"");
  });

  it('clamps an illegal body to the nearest legal one', () => {
    const result = validateBody(ds, { position: 'PG', heightInches: 88, weightPounds: 400, wingspanInches: 120 });
    expect(result.valid).toBe(false);
    expect(result.corrected.heightInches).toBeLessThanOrEqual(result.ranges.height.max);
    expect(result.corrected.weightPounds).toBeLessThanOrEqual(result.ranges.weight.max);
    expect(result.corrected.wingspanInches).toBeLessThanOrEqual(result.ranges.wingspan.max);
  });

  it('moves caps in the direction the data says', () => {
    const short = computeCaps(ds, { position: 'SG', heightInches: 74, weightPounds: 190, wingspanInches: 78 });
    const tall = computeCaps(ds, { position: 'C', heightInches: 86, weightPounds: 260, wingspanInches: 92 });
    expect(short['three_point']!).toBeGreaterThan(tall['three_point']!);
    expect(tall['block']!).toBeGreaterThan(short['block']!);
    expect(tall['interior_defense']!).toBeGreaterThan(short['interior_defense']!);
  });

  it('punishes minimum weight and wingspan on perimeter defense and driving dunk', () => {
    // 2K27 coverage is explicit that a wing at minimum weight and minimum
    // wingspan takes a real hit to these two specifically.
    const body = { position: 'SF', heightInches: 79 } as const;
    const skinny = computeCaps(ds, { ...body, weightPounds: 186, wingspanInches: 76 });
    const filled = computeCaps(ds, { ...body, weightPounds: 250, wingspanInches: 88 });
    expect(filled['perimeter_defense']!).toBeGreaterThan(skinny['perimeter_defense']!);
    expect(filled['driving_dunk']!).toBeGreaterThan(skinny['driving_dunk']!);
  });
});

describe('cost model', () => {
  it('is monotonic and convex over the rating range', () => {
    const cost = costModelFor(ds);
    let previous = 0;
    for (let v = ds.ratingFloor + 1; v <= ds.ratingCeiling; v++) {
      const step = cost.pointCost('three_point', v);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeGreaterThanOrEqual(previous);
      previous = step;
    }
  });

  it('composes: floor->a plus a->b equals floor->b', () => {
    const cost = costModelFor(ds);
    expect(cost.cost('steal', 25, 70) + cost.cost('steal', 70, 88)).toBe(cost.cost('steal', 25, 88));
  });
});

describe('breakpoints', () => {
  it('treats a rating with no threshold above it as the last useful value', () => {
    const caps = computeCaps(ds, WING);
    const bps = collectBreakpoints(ds, WING, caps, {});
    const threePoint = bps['three_point']!;
    expect(threePoint.length).toBeGreaterThan(3);

    // Deadeye Hall of Fame sits at 89 in the placeholder data. Whatever the
    // number is, a rating one above a threshold must resolve back down to it.
    const someThreshold = threePoint.find((b) => b.sources.some((s) => s.kind === 'badge'))!;
    expect(lastUsefulBreakpoint(threePoint, someThreshold.value)).toBe(someThreshold.value);

    const nextUp = threePoint.find((b) => b.value > someThreshold.value && b.sources.some((s) => s.kind !== 'cap'));
    if (nextUp && nextUp.value > someThreshold.value + 1) {
      expect(lastUsefulBreakpoint(threePoint, someThreshold.value + 1)).toBe(someThreshold.value);
    }
  });
});

describe('optimizer', () => {
  it('respects the budget and the caps', () => {
    const request = requestFromArchetype(ds, 'three_and_d_wing');
    const result = optimize(ds, request);
    expect(result.feasible).toBe(true);
    expect(result.builds.length).toBeGreaterThan(0);

    for (const build of result.builds) {
      expect(build.spent).toBeLessThanOrEqual(build.budget);
      for (const a of ds.attributes) {
        expect(build.attributes[a.id]!).toBeLessThanOrEqual(build.caps[a.id]!);
        expect(build.attributes[a.id]!).toBeGreaterThanOrEqual(ds.ratingFloor);
      }
    }
  });

  it('honours hard minimums', () => {
    const request = requestFromArchetype(ds, 'lockdown_defender', {
      minimums: { steal: 85, perimeter_defense: 90 },
    });
    const result = optimize(ds, request);
    expect(result.feasible).toBe(true);
    for (const build of result.builds) {
      expect(build.attributes['steal']!).toBeGreaterThanOrEqual(85);
      expect(build.attributes['perimeter_defense']!).toBeGreaterThanOrEqual(90);
    }
  });

  it('reports infeasibility instead of quietly lowering a requirement', () => {
    const result = optimize(ds, {
      body: { position: 'C', heightInches: 86, weightPounds: 270, wingspanInches: 92 },
      priorities: { three_point_shooting: 100 },
      minimums: { three_point: 99 },
    });
    expect(result.feasible).toBe(false);
    expect(result.infeasibilityReasons.join(' ')).toMatch(/Three-Point/);
    // A best-effort build is still returned so the user can see how close it gets.
    expect(result.builds.length).toBe(1);
  });

  it('does not leave points sitting above the last useful threshold', () => {
    const request = requestFromArchetype(ds, 'two_way_shot_creator');
    const result = optimize(ds, request);
    const top = result.builds[0]!;
    const wasted = top.waste.reduce((a, w) => a + w.refundableBuildPoints, 0);
    // Some slack is acceptable — the optimizer is allowed to buy raw rating in
    // a prioritised category — but it should never be a large share of budget.
    expect(wasted).toBeLessThan(top.budget * 0.12);
  });

  it('prefers the threshold rating over the round number above it', () => {
    // Construct a request where three-point is the only thing that matters and
    // check the result lands on a badge/animation threshold, not one above it.
    const request = requestFromArchetype(ds, 'stretch_big', { resultCount: 1 });
    const result = optimize(ds, request);
    const build = result.builds[0]!;
    const caps = computeCaps(ds, build.body);
    const bps = collectBreakpoints(ds, build.body, caps, request);
    const value = build.attributes['three_point']!;
    const useful = lastUsefulBreakpoint(bps['three_point']!, value);
    expect(value - useful).toBeLessThanOrEqual(2);
  });

  it('returns distinct builds with tradeoff notes', () => {
    const request = requestFromArchetype(ds, 'point_forward', { resultCount: 3 });
    const result = optimize(ds, request);
    expect(result.builds.length).toBeGreaterThan(1);
    for (const b of result.builds) {
      expect(b.tradeoffs.length).toBeGreaterThan(0);
      expect(b.rationale.length).toBeGreaterThan(0);
    }
    const signatures = new Set(result.builds.map((b) => ds.attributes.map((a) => b.attributes[a.id]).join(',')));
    expect(signatures.size).toBe(result.builds.length);
    // Tabs in the UI are labelled by these, so they have to be distinguishable.
    expect(new Set(result.builds.map((b) => b.label)).size).toBe(result.builds.length);
  });

  it('finishes quickly enough for an interactive UI', () => {
    const request = requestFromArchetype(ds, 'inside_center');
    const start = Date.now();
    optimize(ds, request);
    expect(Date.now() - start).toBeLessThan(8000);
  });
});

describe('evaluation report', () => {
  it('produces badges, next thresholds, animations and plans', () => {
    const request = requestFromArchetype(ds, 'slashing_wing');
    const result = optimize(ds, request);
    const build = result.builds[0]!;

    expect(build.badges.length).toBeGreaterThan(0);
    expect(build.nextBadges.every((n) => n.gaps.length > 0)).toBe(true);
    expect(build.animations.length).toBeGreaterThan(0);
    expect(build.takeovers.length).toBe(ds.takeovers.length);
    expect(build.score.total).toBeGreaterThan(0);
  });

  it('only recommends cap breakers on attributes already at the cap', () => {
    const request = requestFromArchetype(ds, 'inside_center');
    const build = optimize(ds, request).builds[0]!;
    for (const rec of build.capBreakerPlan) {
      expect(rec.from).toBe(build.caps[rec.attribute]!);
      expect(rec.breakersUsed).toBeLessThanOrEqual(ds.capBreakers.maxPerAttribute);
    }
    const used = build.capBreakerPlan.reduce((a, r) => a + r.breakersUsed, 0);
    expect(used + build.capBreakersRemaining).toBeLessThanOrEqual(ds.capBreakers.totalAvailable);
  });

  it('never boosts a badge it does not hold', () => {
    const request = requestFromArchetype(ds, 'two_way_guard');
    const build = optimize(ds, request).builds[0]!;
    const held = new Set(build.badges.map((b) => b.badgeId));
    for (const boost of build.badgeBoostPlan) {
      expect(held.has(boost.badgeId)).toBe(true);
    }
    expect(build.badgeBoostPlan.filter((b) => b.slot === 'plusTwo').length).toBeLessThanOrEqual(ds.badgeBoosts.plusTwo.slots);
    expect(build.badgeBoostPlan.filter((b) => b.slot === 'plusOne').length).toBeLessThanOrEqual(ds.badgeBoosts.plusOne.slots);
  });

  it('clamps an over-cap attribute vector rather than trusting it', () => {
    const overcooked: Record<string, number> = {};
    for (const a of ds.attributes) overcooked[a.id] = 99;
    const evaluation = evaluateBuild(ds, WING, overcooked);
    for (const a of ds.attributes) {
      expect(evaluation.attributes[a.id]!).toBeLessThanOrEqual(evaluation.caps[a.id]!);
    }
    expect(evaluation.spent).toBeGreaterThan(computeBudget(ds, WING));
  });
});

describe('natural language mode', () => {
  const prompt =
    "I want a 6'8 wing with the highest three-point rating possible, elite perimeter defense, at least 85 steal, good driving dunk and enough ball handle for good dribble animations.";

  it('extracts body, position, minimums and priorities', () => {
    const parsed = parseBuildRequest(ds, prompt);
    expect(parsed.request.body.heightInches).toBe(80);
    expect(parsed.request.body.position).toBe('SF');
    expect(parsed.request.minimums?.['steal']).toBe(85);
    expect(parsed.request.priorities['three_point_shooting']).toBe(100);
    expect(parsed.request.priorities['perimeter_defense']).toBe(100);
    expect(parsed.request.priorities['driving_dunk']).toBeGreaterThanOrEqual(60);
    expect(parsed.request.softTargets?.['ball_handle']).toBeGreaterThan(ds.ratingFloor);
  });

  it('produces optimizable output end to end', () => {
    const parsed = parseBuildRequest(ds, prompt);
    const result = optimize(ds, parsed.request);
    expect(result.feasible).toBe(true);
    for (const b of result.builds) expect(b.attributes['steal']!).toBeGreaterThanOrEqual(85);
  });

  it('explains what it did with every clause it understood', () => {
    const parsed = parseBuildRequest(ds, prompt);
    expect(parsed.notes.length).toBeGreaterThan(3);
    expect(parsed.notes.some((n) => n.kind === 'minimum')).toBe(true);
    expect(parsed.notes.some((n) => n.kind === 'animation' || n.kind === 'warning')).toBe(true);
  });

  it('handles a big-man prompt too', () => {
    const parsed = parseBuildRequest(ds, 'seven foot center with elite rim protection, great rebounding and no three point shooting');
    expect(parsed.request.body.position).toBe('C');
    expect(parsed.request.body.heightInches).toBe(84);
    expect(parsed.request.priorities['block'] ?? parsed.request.priorities['interior_defense']).toBeGreaterThan(80);
  });
});

describe('2K27 requirement clauses', () => {
  it('treats an "any of" requirement as satisfied by either branch', () => {
    // Deadeye Bronze is "65 Mid-Range OR 65 Three-Point".
    const deadeye = ds.badges.find((b) => b.id === 'deadeye')!;
    const bronze = deadeye.tiers[0]!;
    expect(bronze.requires.length).toBe(1);
    expect(clauseOptions(bronze.requires[0]!).length).toBe(2);

    const base: Record<string, number> = {};
    for (const a of ds.attributes) base[a.id] = ds.ratingFloor;

    expect(meetsRequirements(bronze.requires, { ...base, three_point: 65 })).toBe(true);
    expect(meetsRequirements(bronze.requires, { ...base, mid_range: 65 })).toBe(true);
    expect(meetsRequirements(bronze.requires, { ...base, three_point: 64, mid_range: 64 })).toBe(false);
  });

  it('prices an "any of" gap at the cheaper branch, not both', () => {
    const deadeye = ds.badges.find((b) => b.id === 'deadeye')!;
    const bronze = deadeye.tiers[0]!;
    const base: Record<string, number> = {};
    for (const a of ds.attributes) base[a.id] = ds.ratingFloor;
    const attrs = { ...base, three_point: 60, mid_range: 30 };
    const caps = computeCaps(ds, WING);

    const gaps = gapsFor(ds, bronze.requires, attrs, costModelFor(ds), caps);
    // One gap, not two: you only have to buy one side of an "or".
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.attribute).toBe('three_point');
    expect(gaps[0]!.fromChoice).toBe(true);
  });

  it('requires ALL clauses when they are separate', () => {
    // Posterizer Bronze is "73 Driving Dunk AND 65 Vertical".
    const posterizer = ds.badges.find((b) => b.id === 'posterizer')!;
    const bronze = posterizer.tiers[0]!;
    const base: Record<string, number> = {};
    for (const a of ds.attributes) base[a.id] = ds.ratingFloor;
    expect(meetsRequirements(bronze.requires, { ...base, driving_dunk: 73 })).toBe(false);
    expect(meetsRequirements(bronze.requires, { ...base, driving_dunk: 73, vertical: 65 })).toBe(true);
  });
});

describe('badge tokens', () => {
  it('earns more tokens in a discipline the build invests in', () => {
    const base: Record<string, number> = {};
    for (const a of ds.attributes) base[a.id] = ds.ratingFloor;
    const poor = computeTokens(ds, base);
    const rich = computeTokens(ds, { ...base, three_point: 95, mid_range: 90, free_throw: 80 });
    expect(rich['shooting']!).toBeGreaterThan(poor['shooting']!);
    // Investing in shooting must not conjure defense tokens.
    expect(rich['defense']).toBe(poor['defense']);
  });

  it('never equips more badges than there are slots or tokens', () => {
    const build = optimize(ds, requestFromArchetype(ds, 'three_and_d_wing')).builds[0]!;
    for (const d of build.tokens.byDiscipline) {
      expect(d.slotsUsed).toBeLessThanOrEqual(d.slots);
      expect(d.spent).toBeLessThanOrEqual(d.earned);
      expect(d.remaining).toBe(d.earned - d.spent);
    }
    expect(build.equippedBadges.length).toBe(build.tokens.totalSlotsUsed);
  });

  it('only equips badges the attributes actually make eligible', () => {
    const build = optimize(ds, requestFromArchetype(ds, 'inside_center')).builds[0]!;
    const eligible = new Map(build.badges.map((b) => [b.badgeId, b.levelOrder]));
    for (const e of build.equippedBadges) {
      expect(eligible.has(e.badgeId)).toBe(true);
      expect(e.levelOrder).toBeLessThanOrEqual(eligible.get(e.badgeId)!);
    }
  });

  it('reports badges it could not price rather than silently dropping them', () => {
    const build = optimize(ds, requestFromArchetype(ds, 'inside_center')).builds[0]!;
    // The rebounding and physicals charts were never supplied, so those badges
    // have no token cost and must be surfaced, not hidden.
    expect(build.tokens.unpricedBadges.length).toBeGreaterThan(0);
  });

  it('honours a manual token override', () => {
    const request = { ...requestFromArchetype(ds, 'three_and_d_wing'), tokenOverrides: { shooting: 0 } };
    const build = optimize(ds, request).builds[0]!;
    const shooting = build.tokens.byDiscipline.find((d) => d.discipline === 'shooting')!;
    expect(shooting.earned).toBe(0);
    expect(shooting.spent).toBe(0);
    expect(build.equippedBadges.some((b) => b.category === 'shooting')).toBe(false);
  });
});
