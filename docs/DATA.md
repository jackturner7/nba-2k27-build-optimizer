# Replacing the placeholder data

**Read this first: there is no verified NBA 2K27 data in this repository.**

Every number under `data/2k27/` is a structural placeholder. The shapes are
realistic — they are modelled on how the NBA 2K series works — but the values
are invented so the engine, API and UI have something well-formed to run
against. Badge names, animation names and archetype names are not confirmed to
exist in NBA 2K27 either.

Nothing in the application code hard-codes a game value. The optimizer, the
scoring model, the natural-language parser and the UI all read from these JSON
files, so replacing a file changes the app's behaviour with no code change.

---

## The workflow

```bash
npm run data:validate      # structural + referential checks; exits 1 on error
npm run data:report        # how much is still unverified, and coverage gaps
npm test                   # engine invariants against the current dataset
```

While the API is running you can edit a JSON file and pick it up without a
restart:

```bash
curl -X POST localhost:4000/api/datasets/2k27/reload
```

The web UI has a **Reload data** button in the banner that does the same thing.

---

## Verification tags

Every record carries a `verification` block:

```json
"verification": {
  "status": "unverified",
  "source": null,
  "notes": "Placeholder generated with the initial application scaffold.",
  "lastReviewed": "2026-08-25"
}
```

| status | meaning |
| --- | --- |
| `verified` | Confirmed against the shipped 2K27 builder or an official 2K source. |
| `community-verified` | Reproduced independently by multiple credible testers. |
| `estimated` | Derived or interpolated from partly known data. |
| `unverified` | Placeholder. **This is the default and it is currently universal.** |
| `deprecated` | Known wrong, kept for history, ignored by the engine. |

When you replace a value, update its `status` and fill in `source`. The UI shows
this tag next to the value, and `npm run data:report` tracks the share that is
still placeholder. Do not mark something `verified` you have not personally
confirmed — the whole point of the tag is that a build's trustworthiness is
visible.

Set `data/2k27/meta.json` → `provenance.status` to something other than
`placeholder` and update `uiWarnings.globalBanner` once a meaningful share of
the dataset is real. Until then the warning banner stays up.

---

## File-by-file

### `meta.json`
Provenance, the warning banner text, and the file index. Bump
`datasetVersion` whenever you change data so you can tell builds apart.

### `attributes.json`
The attribute list, their categories, which cost curve each uses, and the
**priority groups** the UI sliders map onto. If 2K27 adds or renames an
attribute, this is the only place its identity is defined; everything else
references it by id.

### `cost-curves.json`
How many build points one point of an attribute costs, as a function of the
rating you are moving *into*. Ranges must tile `ratingFloor+1 … ratingCeiling`
with no gaps — `data:validate` enforces this.

Real 2K curves are steeply convex, which is what makes threshold-aware
optimization worth doing. Keep that shape.

### `positions.json`
Positions and the height band each allows.

### `body.json`
Legal weight and wingspan ranges. Two mechanisms, and the engine consults them
in this order:

1. `overrides.entries` — exact ranges keyed `"<POSITION>:<heightInches>"`, e.g.
   `"SF:80": { "weightMin": 180, "weightMax": 270, "wingspanMin": 77, "wingspanMax": 89 }`.
2. `weightModel` / `wingspanModel` — the linear fallback used when no override
   matches.

Ship verified data by filling in `overrides.entries`; you never have to touch
the fallback model again.

`interactions.rules` is for cases where one slider restricts another (if 2K27
caps wingspan at extreme weights, for instance). It is empty, which the engine
reads as *"no interaction is known"*, not *"no interaction exists"*.

### `caps.json`
**The single highest-leverage file.** Per-attribute maximums as a function of
body settings. Same two-mechanism pattern:

1. `overrides.entries` — keys are `"<POSITION>|<height>|<weight>|<wingspan>"`,
   `*` matches anything, most specific match wins. Value is a partial map of
   attribute id → cap:
   ```json
   "SF|80|215|85": { "three_point": 88, "perimeter_defense": 90 },
   "C|*|*|*":      { "three_point": 74 }
   ```
2. `attributeCaps` — the linear model:
   ```
   cap = baseCap
       + perInchHeight   * (height   - refHeight)
       + perPoundWeight  * (weight   - refWeight)
       + perInchWingspan * (wingspan - refWingspan)
       + positionAdjust[position]
   ```
   clamped to `[hardMin, hardMax]`.

The current coefficients only encode the *direction* of each body effect. Their
magnitudes are guesses.

### `budget.json`
Total build points. NBA 2K does not display such a number in the builder — the
constraint shows up as caps plus escalating costs — but an optimizer needs an
explicit budget, so this models one.

`base` is **calibrated jointly with `cost-curves.json`** so that a plausible
full build is exactly affordable. Change one without the other and builds will
look either impossibly stacked or absurdly bare.

If 2K27 turns out to have no shared pool at all, set `enabled: false` and the
engine optimizes against caps alone.

### `badges.json`
Badges, their level ladder, and the attribute thresholds for each level.

- Each tier's `requires` list is **conjunctive** — all conditions must hold.
- Ladders are enforced monotonic: a build cannot hold Gold without also
  satisfying Silver, whatever the file says.
- `impact` (1–5) is a hand-set weight for how much the badge matters in
  practice. It feeds the Badge Value score component. Tune it by feel; it is
  designer judgement, not game data.
- `restrictions` gates a badge on height/weight/wingspan/position.

This file is what the optimizer's entire notion of "stop here" comes from. It is
the first thing to replace.

### `animations.json`
Animation packages and their requirements. Same conjunctive `requires`, plus an
optional `bodyRequires`. Contact dunk packages and quick-release jumpers are the
requirements players actually build around, so these thresholds matter roughly
as much as badges do.

### `takeovers.json`
Takeovers and their unlock tiers. `slots` records how many a player gets — set
it once 2K27's structure is known.

### `cap-breakers.json`
The post-launch above-the-cap mechanic. Count, per-attribute limit, eligibility
and whether they cost build points are all unknown and invented.

The optimizer treats cap breakers as a **post-build overlay**: it optimizes the
build first, then measures which single `+1` crosses the most valuable
threshold. It only ever recommends them on attributes already sitting at the
cap, and it reports leftovers as unplaceable rather than inventing a home for
them.

### `badge-boosts.json`
The "maximum +1 / +2 badge boost" mechanic. Slot counts, stacking rules and
whether a boost can reach Legend are all unknown. Set `enabled: false` if 2K27
has no such mechanic and the app stops reporting boosts entirely.

### `dependencies.json`
Declared couplings between attributes. 2K exposes no formal dependencies, but
real builds have strong practical ones — Speed With Ball is wasted without Ball
Handle. Three kinds:

- `hard-min` — target must reach a floor or the build is invalid.
- `soft-link` — score treats target as `min(target, source * ratio + offset)`.
- `diminishing` — value above `threshold` is scaled by `factor` unless `source`
  reaches `sourceMin`.

These are **modelling choices, not game rules**, and they are labelled as such.
Set `enabled: false` on any you disagree with.

### `archetypes.json`
Named presets. These are community archetype names from across the series;
2K27's official build naming is unknown. `priorities` maps priority group ids to
0–100 weights, `constraints.minimums` are hard floors, `constraints.softTargets`
are worth score but not required.

---

## Coverage gaps matter as much as wrong values

The engine only spends points that cross a threshold. An attribute that no
badge, animation or takeover requires is worth almost nothing to it and will sit
at the rating floor in **every** build.

That is correct behaviour given incomplete data, and it looks like a bug unless
the gap is visible — so `npm run data:report` lists coverage per attribute and
the UI shows a "Dataset coverage gaps" panel.

In the current placeholder set, for example, Free Throw has no requirements at
all and Speed has one, so builds leave them at 25. The fix is to add the real
NBA 2K27 requirements, not to invent a threshold to make the number look right.

---

## Adding another game year

Create `data/2k28/` with the same fourteen files and the API serves it at
`/api/datasets/2k28/...`. Nothing is hard-coded to `2k27` except the default in
`apps/api/src/server.ts` (`DATASET_ID`) and the constant in
`apps/web/src/App.tsx`.
