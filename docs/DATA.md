# The dataset: what is sourced, what is not, and how to replace it

**Read this first: the dataset is PARTIALLY sourced.** Some of it is real 2K27
data; a lot of it is still invented. The two are labelled record by record and
you should not treat them the same way.

### Official (from 2K)

[2K's MyPLAYER Builder page](https://nba.2k.com/2k27/features/myplayer-builder/)
is the authority for the *mechanics*, and it settled several things this project
had guessed wrong:

| | |
| --- | --- |
| 53 badges, six disciplines | matches the dataset exactly |
| 20 badge slots per build | all available immediately; tokens are the gate |
| Tokens earned by **playing** | discipline meters, practice drills, Gatorade workouts — *not* attribute allocation |
| Token cost varies by **size and position** | "taller players may see a different number of tokens required than shorter ones for the same Badge" |
| **Legend** exists but not at build creation | reached only through Synergy |
| **Synergy**: 16 slots, 12 × +1 and 4 × +2 | a Fused badge also refunds its tokens |
| 5 Takeover slots, 24 abilities (19 unlockable), 15 Perks | |
| Cap Breaker preview at 99 OVR in the Builder | |

### Sourced (trust, but re-check)

- **All 53 badges** — requirements, AND/OR logic and per-badge **height ranges** —
  from [NBA 2K Lab](https://www.nba2klab.com/badge-requirements), collected at
  NBA 2K27 Community Day. Re-import with `node scripts/import-2klab.mjs`.
- **Badge token costs** for 42 of the 53, from the 2K27 badge cost charts. 2K Lab
  does not publish token costs, so the two sources are complementary and the
  importer preserves them.
- **Animation and takeover thresholds** named on the community "best value
  attribute thresholds" sheet.
- **The attribute list.** Stamina is *not* a 2K27 builder attribute (it is
  raised at the in-game Gatorade gym). Acceleration is gone; **Agility** is what
  2K27 badges actually require. Rebounding is its own discipline.
- **Five badge tiers** — Bronze / Silver / Gold / Hall of Fame, plus Legend,
  which 2K states cannot be obtained at build creation and carries no attribute
  requirement row.
- **The direction** of each body setting's effect on caps, including that a wing
  at minimum weight and minimum wingspan takes a real hit to Perimeter Defense
  and Driving Dunk specifically.
- **That badge tokens exist**, are earned by *playing* rather than by allocating
  attributes, must be spent to equip badges, and that cap breakers do not grant
  extra tokens.

### Read off the real builder (NBA 2K HQ app)

- **All 21 attribute caps for one body** — PF, 6'11", 210 lb, 6'11" wingspan,
  which the app names **Bucket Chaser**. In `caps.json` →
  `overrides.entries["PF|83|210|83"]`.
- **That body's full cap breaker table** — five slots per attribute, each worth
  a different amount, gains diminishing down the row, and seven attributes
  locked out of breakers entirely.

Having one real cap table made it possible to *score* the linear model for the
first time: mean absolute error **12.9 points** over 21 attributes, biased high
on **19 of 21**, and wrong in sign on shooting for a slender big — it predicts
86 Mid-Range / 84 Three where the builder gives 94 / 91. Recorded in
`caps.json` → `capModel.measuredAccuracy`.

The model was deliberately **not** refit to it. Fitting four coefficients per
attribute to a single body produces something that looks calibrated and is not.

### Not sourced (assume wrong)

- **Attribute caps for every body except `PF|83|210|83`.** Only directions are
  known, not magnitudes, and the magnitudes are measurably ~13 points off.
- **Cost curves and the build point budget.**
- **The badge token earning formula** and the per-discipline slot split.
- **How many cap breakers a player may claim**, and **badge boost slot counts**.
  The per-slot cap breaker *gains* are now verified for one body; the *budget*
  is not.

### Inferred

- **Token costs for the 11 Rebounding and Physicals badges.** Their cost charts
  were never supplied. Every badge whose cost *is* known follows exactly one of
  three ladders — 1/3/4/5, 2/4/5/6, 3/5/6/7 — so the middle ladder is used as a
  fallback and flagged as estimated wherever it appears. Disable it via
  `badge-tokens.json` → `fallbackTokenCost.enabled` to make them unequippable
  instead, which is the strictly honest option.

Nothing in the application code hard-codes a game value. The optimizer, the
scoring model, the natural-language parser and the UI all read from these JSON
files, so replacing a file changes the app's behaviour with no code change.

---

## The workflow

```bash
npm run data:validate      # structural + referential checks; exits 1 on error
npm run data:report        # how much is still unverified, and coverage gaps
npm run data:crosscheck    # diff against independent sources; exits 1 on an unrecorded conflict
npm test                   # engine invariants against the current dataset
```

### Cross-checking against a second source

`data/<id>/sources/*.json` holds independently-produced transcriptions of the
same data. They are **not loaded by the app** — they exist so the shipped dataset
can be diffed against something that did not come from the same place.

Two sources agreeing on a threshold is much stronger evidence than one. Where
they disagree, `data:crosscheck` **fails** unless the conflict is recorded in
that source's `knownConflicts` with a note saying which side the dataset follows
and why. A conflict can be accepted; it cannot be ignored.

Today the badge data is corroborated by a second chart that agrees on 211 of 212
tiers and height gates. The single disagreement — Smooth Operator's height cap —
is recorded and shown in the app.

To add a source, drop a file in `sources/` following the format documented at the
top of the existing one, then run the cross-check.

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
| `verified` | Confirmed against the shipped 2K27 builder or an official 2K source. **Nothing currently claims this.** |
| `community-verified` | Taken from the supplied 2K27 badge charts or community threshold sheets. Trust with care. |
| `estimated` | Derived, interpolated, or read off a degraded source image. Directionally useful, numerically approximate. |
| `unverified` | Placeholder. Shaped correctly, numerically meaningless. |
| `deprecated` | Known wrong, kept for history, ignored by the engine. |

Four rows that were previously `estimated` because the chart images were
unreadable have been **resolved** against 2K Lab: Post Fade Phenom (Bronze
Mid-Range is 60, not 83 — the ladder was monotonic all along), Pick Dodger,
Wall Up and Post Lockdown. Mini Marksman also gained the attribute requirements
the chart image omitted entirely.

When you replace a value, update its `status` and fill in `source`. The UI shows
this tag next to the value, and `npm run data:report` tracks the share that is
still placeholder. Do not mark something `verified` you have not personally
confirmed — the whole point of the tag is that a build's trustworthiness is
visible.

Set `data/2k27/meta.json` → `provenance.status` and `uiWarnings.globalBanner` as
the picture changes. It is currently `partial`, and the banner says which half
is which.

---

## File-by-file

### `meta.json`
Provenance, the warning banner text, and the file index. Bump
`datasetVersion` whenever you change data so you can tell builds apart.

### `attributes.json`
The attribute list, their six disciplines, which cost curve each uses, and the
**priority groups** the UI sliders map onto. If 2K27 adds or renames an
attribute, this is the only place its identity is defined; everything else
references it by id.

The disciplines here must line up with `badge-tokens.json` → `disciplines`,
because tokens are earned from the attributes in a discipline. `data:validate`
enforces that.

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
   `*` matches anything, most specific match wins. **This is where real data
   goes**, and it takes precedence over the model entirely:
   ```json
   "PF|83|210|83": {
     "label": "6'11\" / 210 lb / 6'11\" PF — Bucket Chaser",
     "verification": { "status": "verified", "source": "NBA 2K HQ app builder" },
     "caps": { "three_point": 91, "block": 70, "…": 0 }
   }
   ```
   One body is filled in. Adding another is the single most valuable thing you
   can do to this dataset — open the build in the NBA 2K HQ app, read the
   attribute page with everything pushed to its ceiling, and paste the 21
   numbers in. The UI tells you, per body, whether you are looking at real caps
   or modelled ones.
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
Badges, their level ladder, the attribute thresholds for each level, the
**height range** each is available at, and the **badge token cost** of each tier.

**Generated by `scripts/import-2klab.mjs`.** Hand-edits to requirements will be
overwritten on the next import; token costs, `impact` and descriptions are
preserved across imports because 2K Lab does not supply them.

**Height gating.** `restrictions` is present only when a badge is narrower than
the builder's full 5'9"–7'4" range. 25 of the 53 badges are gated, and this is a
hard constraint rather than a cost: a 7'0" centre cannot hold Seatbelt or Ankle
Braces at *any* rating, and a 6'0" guard cannot hold Wall Up or Paint Patroller.
The optimizer will not chase a threshold for a badge the body can never hold, and
the UI lists what a given height locks out.

**Requirement format.** `requires` is a list of clauses that must *all* hold. A
clause is either a single minimum or an `anyOf` choice:

```json
"requires": [
  { "anyOf": [ {"attribute":"mid_range","min":65}, {"attribute":"three_point","min":65} ] },
  { "attribute": "post_control", "min": 55 }
]
```

That reads as *"(65 Mid-Range **or** 65 Three-Point) **and** 55 Post Control"*.
2K27 uses `anyOf` constantly — Deadeye, Quick Trigger, Unpluckable, Aerial
Wizard, Float Game, Ghost Stepper, Off-Ball Pest. The engine only ever prices
the **cheapest branch** of a choice, because you only have to buy one side.

Other fields:

- `tokenCost` — badge tokens to equip that tier. `null` means unknown, and a
  badge with an unknown cost can never be equipped; the app reports it rather
  than pretending.
- `incompleteTiers: true` — the source only covered some tiers. Suppresses the
  "no token cost" warning.
- Ladders are enforced monotonic at runtime: a build cannot hold Gold without
  also satisfying Silver, whatever the file says. A file that *does* go backwards
  gets a warning (Post Fade Phenom currently does — its Bronze Mid-Range
  requirement reads higher than its Silver, which is probably a chart misprint).
- `impact` (1–5) is a hand-set weight for how much the badge matters in
  practice. It feeds the Badge Value score component. Tune it by feel; it is
  designer judgement, **not game data**.
- `restrictions` gates a badge on height/weight/wingspan/position (Mini Marksman
  is 6'4" or shorter, with no attribute requirement at all).

### `badge-tokens.json`
The 2K27 token economy, and the second budget the optimizer has to respect.

**`tokenGrants.mode` defaults to `flat`, and that is deliberate.** An earlier
version derived the token pool from attribute investment. 2K's page says plainly
that tokens come from playing, so that model was wrong in kind, not just in its
constants. How many tokens you have is a fact about *your account*; set
`flatByDiscipline` — or the UI inputs — to what you actually own.
`linear-by-investment` is retained only for planning in the abstract.

**`costByBody`** exists because 2K states token cost varies with size and
position. The costs in `badges.json` came from charts that do not say which body
they were captured at, so they are a single-body snapshot. The adjustment is
zero by default — meaning *no relationship is known*, not that none exists.

Meeting a threshold makes a badge **eligible**. Equipping it costs **tokens**
from that discipline's pool and takes one of that discipline's **slots**. A
build is routinely eligible for twice as many badges as it can afford, so an
attribute threshold you cannot cash in is not worth chasing.

- `tokenGrants.mode`
  - `linear-by-investment` (default) — `floor(Σ max(0, rating − freeBelow) / pointsPerToken)`.
    Captures only the *direction*; the constants are invented.
  - `table` — an exact list of ratings that each grant a token. This is what the
    game actually does ("sometimes just one point provides an additional badge
    token"). Use it once the real breakpoints are known.
  - `manual` — ignore attributes, use `manualTokens`.
- `manualTokens` / the UI's per-discipline inputs — type your real in-game token
  counts and the optimizer plans against those instead. **This is the best way to
  use the app right now**, because the earning formula is the weakest guess in
  the file.
- `slots.total` is 20 (sourced); the per-discipline split is invented.
- `upgradeCostMode` — whether upgrading pays the difference or the full new tier
  price. Unknown; `absolute` is the conservative reading.

### `animations.json`
Animation packages and their requirements. Same conjunctive `requires`, plus an
optional `bodyRequires`. Contact dunk packages and quick-release jumpers are the
requirements players actually build around, so these thresholds matter roughly
as much as badges do.

### `takeovers.json`
Takeovers and their unlock tiers. `slots` records how many a player gets — set
it once 2K27's structure is known.

### `cap-breakers.json`
The post-launch above-the-cap mechanic, and a **per-body lookup table** rather
than a formula. Every attribute has five slots; each is worth a different,
per-attribute amount; gains diminish down the row; and slots can be locked out
entirely. `null` in a slot array means locked.

```json
"PF|83|210|83": {
  "label": "…",
  "verification": { "status": "verified", "source": "NBA 2K HQ app" },
  "attributes": {
    "block":     { "slots": [6, 5, 4, 3, 2],                  "newCap": 90 },
    "steal":     { "slots": [7, null, null, null, null],      "newCap": 67 },
    "mid_range": { "slots": [null, null, null, null, null],   "newCap": 94 }
  }
}
```

`newCap` is deliberately redundant — the loader checks that the cap in
`caps.json` under the same key plus the slot gains equals it, and errors if a
row was mis-read. It also rejects an unlocked slot following a locked one, since
slots fill in order and that gain would be unreachable.

**A body with no entry gets no cap breaker plan.** Gains run from +1 to +7
across attributes on a single frame, so there is nothing safe to extrapolate.

The optimizer treats cap breakers as a **post-build overlay**: it optimizes the
build first, then allocates slots against the table, always taking whichever run
of slots buys the most unlock value per slot spent. It only recommends them on
attributes already at their cap, and reports leftovers as unplaceable rather
than inventing a home for them.

**`allocation` is the open question.** The builder shows five slots per
attribute and a `newCap` assuming all five are filled, which is equally
consistent with a scarce shared pool and with every attribute filling its own
slots independently. The second reading would hand the transcribed frame +112
attribute points, so the default is `"shared-pool"` with `poolSize: 5` — the
reading that can under-promise but never over-promise. Flip `mode` to
`"per-attribute"` if the generous reading turns out to be right.

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

In the current set, for example, Free Throw has no requirements at all in any
supplied chart, so builds leave it at 25. The fix is to add the real NBA 2K27
requirements, not to invent a threshold to make the number look right.

The same applies to token costs: a badge whose `tokenCost` is `null` can never
be equipped, and the app lists it under "unpriced" rather than quietly dropping
it.

---

## Adding another game year

Create `data/2k28/` with the same fourteen files and the API serves it at
`/api/datasets/2k28/...`. Nothing is hard-coded to `2k27` except the default in
`apps/api/src/server.ts` (`DATASET_ID`) and the constant in
`apps/web/src/App.tsx`.
