import { describe, expect, it } from 'vitest';
import { loadDatasetFromDisk, loadSecondSources } from '../data/node-loader.js';
import { crossCheckBadges } from '../data/crosscheck.js';
import { checkReferentialIntegrity, verificationReport } from '../data/loader.js';
import { datasetCoverage } from '../data/coverage.js';
import { collectBreakpoints, lastUsefulBreakpoint } from '../engine/breakpoints.js';
import { capBreakerTableFor, computeBudget, computeCaps } from '../engine/caps.js';
import { planCapBreakers, unlockValue } from '../engine/plans.js';
import { costModelFor } from '../engine/cost.js';
import { evaluateBuild } from '../engine/evaluate.js';
import { optimize } from '../engine/optimize.js';
import { requestFromArchetype } from '../engine/archetype.js';
import { formatHeight, parseHeight, validateBody } from '../engine/body.js';
import { clauseOptions, gapsFor, meetsBody, meetsRequirements } from '../engine/requirements.js';
import { badgeLevelFor } from '../engine/unlocks.js';
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
    expect(ds.meta.provenance.status).toBe('partial');
    // The files that are still guesses must still say so.
    expect(ds.budget.verification.status).toBe('unverified');
    expect(ds.costCurves.every((c) => c.verification.status === 'unverified')).toBe(true);
  });

  it('only claims "verified" where an official 2K source is cited', () => {
    // 'verified' is reserved for things 2K themselves published. Anything
    // claiming it must name where it came from.
    const verified = [
      ['badge-tokens', ds.badgeTokens.verification],
      ['badge-tokens.slots', ds.badgeTokens.slots.verification],
      ['badge-tokens.rules', ds.badgeTokens.rules.verification],
      ['badge-boosts', ds.badgeBoosts.verification],
      ['badge-boosts.rules', ds.badgeBoosts.rules.verification],
      ['badges.globalRules', ds.badgeGlobalRules.verification],
    ].filter(([, v]) => (v as { status: string })?.status === 'verified');

    expect(verified.length).toBeGreaterThan(0);
    for (const [name, v] of verified) {
      expect(`${name}: ${(v as { source?: string | null }).source ?? ''}`).toMatch(/2K official/i);
    }
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

  it('has four buildable badge tiers plus an unbuildable Legend', () => {
    expect(ds.badgeLevels.map((l) => l.id)).toEqual(['bronze', 'silver', 'gold', 'hof', 'legend']);

    // 2K official: "Legend Badges cannot be obtained at build creation, but they
    // can still be earned." So Legend must exist as a level but must never carry
    // an attribute requirement — it is reached by Synergy, not by a rating.
    const legend = ds.badgeLevels.find((l) => l.id === 'legend')!;
    expect(legend.obtainableAtBuildCreation).toBe(false);
    expect(ds.badgeGlobalRules.legendRequiresSynergy).toBe(true);
    for (const badge of ds.badges) {
      expect(badge.tiers.some((t) => t.level === 'legend')).toBe(false);
    }
  });

  it('matches the badge count 2K published', () => {
    // 2K official: "There are 53 Badges in 2K27".
    expect(ds.badges.length).toBe(53);
  });

  it('models the Synergy slot counts 2K published', () => {
    // 2K official: "16 total Synergy slots. Twelve ... +1 boost, and four ... +2".
    expect(ds.badgeBoosts.totalSlots).toBe(16);
    expect(ds.badgeBoosts.plusOne.slots).toBe(12);
    expect(ds.badgeBoosts.plusTwo.slots).toBe(4);
    expect(ds.badgeBoosts.plusOne.slots + ds.badgeBoosts.plusTwo.slots).toBe(ds.badgeBoosts.totalSlots);
  });

  it('models the 20 badge slots 2K published', () => {
    expect(ds.badgeTokens.slots.total).toBe(20);
    const split = Object.values(ds.badgeTokens.slots.byDiscipline).reduce((a, b) => a + b, 0);
    expect(split).toBe(20);
    expect(ds.badgeTokens.disciplines).toEqual(['shooting', 'finishing', 'playmaking', 'defense', 'rebounding', 'physicals']);
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

describe('second-source cross-check', () => {
  const sources = loadSecondSources('2k27');

  it('has at least one independent source to check against', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('agrees with every independent source, or records why not', () => {
    for (const source of sources) {
      const report = crossCheckBadges(ds, source);
      // Every badge the source covers must exist in the dataset.
      expect(report.onlyInSource).toEqual([]);
      expect(report.tiersCompared).toBeGreaterThan(100);

      // A disagreement is allowed — sources differ — but it must be recorded
      // in the source file with a note saying which side is trusted and why.
      // Silently picking a winner is the thing this guards against.
      const undocumented = report.undocumentedConflicts.map((c) => `${c.badge}.${c.field}: dataset=${c.dataset} source=${c.source}`);
      expect(undocumented).toEqual([]);

      // Two independently-produced sources should overwhelmingly agree; if this
      // drops, one of them has been mis-transcribed.
      expect(report.agreementRate).toBeGreaterThan(0.95);
    }
  });

  it('would actually catch a divergence', () => {
    const source = sources[0]!;
    const firstId = Object.keys(source.badges)[0]!;
    const tampered = {
      ...source,
      badges: { ...source.badges, [firstId]: { ...source.badges[firstId]!, tiers: ['99 strength', '99 strength', '99 strength', '99 strength'] } },
    };
    const report = crossCheckBadges(ds, tampered);
    expect(report.undocumentedConflicts.length).toBeGreaterThan(0);
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
    }
    const used = build.capBreakerPlan.reduce((a, r) => a + r.breakersUsed, 0);
    expect(used + build.capBreakersRemaining).toBeLessThanOrEqual(ds.capBreakers.allocation.poolSize);
  });

  it('plans no cap breakers for a body with no transcribed gain table', () => {
    const request = requestFromArchetype(ds, 'inside_center');
    const build = optimize(ds, request).builds[0]!;
    const hasTable = capBreakerTableFor(ds, build.body) !== null;
    if (!hasTable) {
      // Gains run from +1 to +13 across attributes on the transcribed builds,
      // so an untranscribed body must get nothing rather than an extrapolation.
      expect(build.capBreakerPlan).toEqual([]);
      expect(build.capBreakerStatus.kind).toBe('no-data');
    } else {
      expect(build.capBreakerStatus.kind).toBe('planned');
    }
  });


  it('catches a mis-transcribed cap breaker row', () => {
    // The ladders and the caps come from the same screenshots, and newCap is
    // deliberately redundant: sampledAt + slots must equal it. This proves the
    // check is load-bearing rather than decorative.
    const key = Object.keys(ds.capBreakers.gainTables.entries)[0];
    if (!key) return;
    const table = ds.capBreakers.gainTables.entries[key]!;
    const attr = Object.keys(table.attributes)[0]!;
    const tampered = {
      ...ds,
      capBreakers: {
        ...ds.capBreakers,
        gainTables: {
          entries: {
            ...ds.capBreakers.gainTables.entries,
            [key]: {
              ...table,
              attributes: {
                ...table.attributes,
                [attr]: { ...table.attributes[attr]!, newCap: table.attributes[attr]!.newCap + 3 },
              },
            },
          },
        },
      },
    };
    const errors = checkReferentialIntegrity(tampered).filter((i) => i.severity === 'error');
    expect(errors.some((e) => e.message.includes('does not add up'))).toBe(true);
  });

  it('derives every exact cap from a ladder that locks, and every floor from one that does not', () => {
    // This is the invariant the 0.7.0 correction turned on: a locked slot means
    // the ladder hit the frame's ceiling, so its newCap IS the cap; a ladder that
    // spends all five slots without locking only proves a lower bound.
    let exact = 0;
    let floors = 0;
    for (const table of Object.values(ds.capBreakers.gainTables.entries)) {
      const entry = ds.caps.overrides[table.body];
      expect(entry).toBeDefined();
      for (const [id, row] of Object.entries(table.attributes)) {
        if (row.slots.some((s) => s === null)) {
          expect(entry!.caps[id]).toBe(row.newCap);
          exact++;
        } else {
          expect(entry!.capFloors[id]).toBe(row.newCap);
          expect(entry!.caps[id]).toBeUndefined();
          floors++;
        }
      }
    }
    expect(exact).toBeGreaterThan(20);
    expect(floors).toBeGreaterThan(20);
  });

  it('never reports a cap below a rating the builder was seen to reach', () => {
    for (const [key, entry] of Object.entries(ds.caps.overrides)) {
      const [position, h, w, ws] = key.split('|');
      const caps = computeCaps(ds, {
        position: position!,
        heightInches: Number(h),
        weightPounds: Number(w),
        wingspanInches: Number(ws),
      });
      for (const [attr, cap] of Object.entries(entry.caps)) expect(caps[attr]).toBe(cap);
      // A floor is a proven lower bound, so the model may exceed it but never undercut it.
      for (const [attr, floor] of Object.entries(entry.capFloors)) {
        expect(caps[attr]).toBeGreaterThanOrEqual(floor as number);
      }
    }
  });

  it('will not apply a cap breaker ladder to an allocation it was not measured at', () => {
    // Gains are relative to what the sampled player allocated. Applying that
    // ladder to a build sitting somewhere else is exactly the class of guess
    // that produced the 0.7.0 correction.
    const table = Object.values(ds.capBreakers.gainTables.entries)[0];
    if (!table) return;
    const [position, h, w, ws] = table.body.split('|');
    const body = {
      position: position!,
      heightInches: Number(h),
      weightPounds: Number(w),
      wingspanInches: Number(ws),
    };
    const caps = computeCaps(ds, body);

    // Sitting exactly where it was sampled: the ladder applies.
    const atSample = { ...caps, ...table.sampledAt } as Record<string, number>;
    const matched = planCapBreakers(ds, atSample, body, caps, {});
    expect(matched.status.kind).toBe('planned');
    for (const rec of matched.plan) {
      expect(rec.from).toBe(table.sampledAt[rec.attribute]);
      expect(rec.to).toBeLessThanOrEqual(table.attributes[rec.attribute]!.newCap);
    }

    // One point away on every attribute: nothing applies, and it says so.
    const shifted: Record<string, number> = {};
    for (const [k, v] of Object.entries(atSample)) shifted[k] = Math.max(ds.ratingFloor, v - 1);
    const mismatched = planCapBreakers(ds, shifted, body, caps, {});
    expect(mismatched.plan).toEqual([]);
    expect(mismatched.status.kind).toBe('allocation-mismatch');
  });

  it('spends breakers on a run of slots when no single slot crosses anything', () => {
    // Pass Accuracy's slots are +2 each on the Bucket Chaser build, and none of
    // them alone crosses a threshold - but three together do. A planner that
    // only looked one slot ahead saw a zero gain, stopped, and left all five
    // breakers unplaced. This is that bug.
    const table = ds.capBreakers.gainTables.entries['bucket_chaser'];
    if (!table) return;
    const body = { position: 'PF', heightInches: 83, weightPounds: 210, wingspanInches: 83 };
    const caps = computeCaps(ds, body);
    const plan = planCapBreakers(ds, { ...caps, ...table.sampledAt } as Record<string, number>, body, caps, {});

    expect(plan.plan.length).toBeGreaterThan(0);
    const multi = plan.plan.find((p) => p.breakersUsed > 1);
    expect(multi).toBeDefined();
    expect(multi!.unlocks.length).toBeGreaterThan(0);
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

describe('badge height gating', () => {
  it('locks a height-gated badge out entirely, at any rating', () => {
    // Seatbelt is 5'9"-6'9" and Wall Up is 6'5"-7'4": no rating unlocks the
    // wrong one, so height is a hard build decision, not a soft cost.
    const seatbelt = ds.badges.find((b) => b.id === 'seatbelt')!;
    const wallUp = ds.badges.find((b) => b.id === 'wall_up')!;
    expect(seatbelt.restrictions?.maxHeightInches).toBeDefined();
    expect(wallUp.restrictions?.minHeightInches).toBeDefined();

    const maxed: Record<string, number> = {};
    for (const a of ds.attributes) maxed[a.id] = ds.ratingCeiling;

    const tall: BuildBody = { position: 'C', heightInches: 86, weightPounds: 260, wingspanInches: 92 };
    const small: BuildBody = { position: 'PG', heightInches: 72, weightPounds: 180, wingspanInches: 76 };

    expect(badgeLevelFor(ds, seatbelt, maxed, tall)).toBeNull();
    expect(badgeLevelFor(ds, seatbelt, maxed, small)).not.toBeNull();
    expect(badgeLevelFor(ds, wallUp, maxed, small)).toBeNull();
    expect(badgeLevelFor(ds, wallUp, maxed, tall)).not.toBeNull();
  });

  it('never equips a badge the build is too tall or too short for', () => {
    for (const archetype of ['inside_center', 'two_way_guard']) {
      const build = optimize(ds, requestFromArchetype(ds, archetype)).builds[0]!;
      for (const equipped of build.equippedBadges) {
        const def = ds.badges.find((b) => b.id === equipped.badgeId)!;
        expect(meetsBody(build.body, def.restrictions)).toBe(true);
      }
    }
  });

  it('does not chase a threshold for a badge the body cannot hold', () => {
    // A centre should not be pushed toward Seatbelt's Agility requirement.
    const build = optimize(ds, requestFromArchetype(ds, 'inside_center')).builds[0]!;
    const seatbelt = ds.badges.find((b) => b.id === 'seatbelt')!;
    expect(meetsBody(build.body, seatbelt.restrictions)).toBe(false);
    expect(build.badges.some((b) => b.badgeId === 'seatbelt')).toBe(false);
  });
});

describe('badge tokens', () => {
  it('does not derive the token pool from attribute spend', () => {
    // 2K official: tokens come from playing — discipline meters, practice drills,
    // Gatorade workouts — NOT from how you allocate attributes in the builder.
    // An earlier version of this app had that backwards.
    const base: Record<string, number> = {};
    for (const a of ds.attributes) base[a.id] = ds.ratingFloor;
    const poor = computeTokens(ds, base);
    const rich = computeTokens(ds, { ...base, three_point: 95, mid_range: 90, free_throw: 80 });
    expect(rich['shooting']).toBe(poor['shooting']);
    expect(ds.badgeTokens.tokenGrants.mode).toBe('flat');
  });

  it('lets the player supply their real token counts', () => {
    const base: Record<string, number> = {};
    for (const a of ds.attributes) base[a.id] = ds.ratingFloor;
    const overridden = computeTokens(ds, base, { shooting: 3, defense: 25 });
    expect(overridden['shooting']).toBe(3);
    expect(overridden['defense']).toBe(25);
    // Disciplines left alone keep the dataset's pool.
    expect(overridden['rebounding']).toBe(computeTokens(ds, base)['rebounding']);
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

  it('flags badges priced from the fallback rather than passing them off as sourced', () => {
    const build = optimize(ds, requestFromArchetype(ds, 'inside_center')).builds[0]!;
    // The Rebounding and Physicals cost charts were never supplied. With the
    // fallback on they are priced and equippable, but must be reported as
    // inferred; with it off they must be reported as unpriced. Never silent.
    const fallbackOn = ds.badgeTokens.fallbackTokenCost.enabled;
    if (fallbackOn) {
      expect(build.tokens.inferredCostBadges.length).toBeGreaterThan(0);
      for (const b of build.equippedBadges) {
        const def = ds.badges.find((x) => x.id === b.badgeId)!;
        const sourced = def.tiers.find((t) => t.level === b.level)?.tokenCost !== null;
        expect(b.tokenCostInferred ?? false).toBe(!sourced);
      }
    } else {
      expect(build.tokens.unpricedBadges.length).toBeGreaterThan(0);
    }
  });

  it('can equip rebounding and physicals badges on a big', () => {
    // Regression: before the Rebounding/Physicals data arrived these two
    // disciplines could never be filled, quietly gutting every big-man build.
    const build = optimize(ds, requestFromArchetype(ds, 'inside_center')).builds[0]!;
    const disciplines = new Set(build.equippedBadges.map((b) => b.category));
    expect(disciplines.has('rebounding')).toBe(true);
    expect(disciplines.has('physicals')).toBe(true);
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
