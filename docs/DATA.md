# The dataset: what is sourced, what is not, and how to replace it

**Read this first: the dataset is PARTIALLY sourced.** Some of it is real 2K27
data; a lot of it is still invented. The two are labelled record by record and
you should not treat them the same way.

### Sourced (trust, but re-check against the NBA 2K HQ app)

- **Every badge requirement and badge token cost** for Shooting, Playmaking,
  Defense and Finishing, from the 2K27 badge cost charts.
- **Animation and takeover thresholds** named on the community "best value
  attribute thresholds" sheet.
- **The attribute list.** Stamina is *not* a 2K27 builder attribute (it is
  raised at the in-game Gatorade gym). Acceleration is gone; **Agility** is what
  2K27 badges actually require. Rebounding is its own discipline.
- **Four badge tiers** — Bronze / Silver / Gold / Hall of Fame. No Legend tier.
- **The direction** of each body setting's effect on caps, including that a wing
  at minimum weight and minimum wingspan takes a real hit to Perimeter Defense
  and Driving Dunk specifically.
- **That badge tokens exist**, are earned per discipline from attribute
  investment, must be spent to equip badges, and that cap breakers do not grant
  extra tokens.

### Not sourced (assume wrong)

- **Attribute caps.** Only directions are known, not magnitudes.
- **Cost curves and the build point budget.**
- **The badge token earning formula** and the per-discipline slot split.
- **Cap breaker quantities** and **badge boost slot counts**.

### Missing entirely

- **The Rebounding and Physicals badge cost charts.** The few badges present in
  those disciplines were reconstructed from single lines on the best-value
  sheet, carry one tier each, are flagged `incompleteTiers`, and have no token
  cost — so the optimizer cannot equip them and says so.

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
| `verified` | Confirmed against the shipped 2K27 builder or an official 2K source. **Nothing currently claims this.** |
| `community-verified` | Taken from the supplied 2K27 badge charts or community threshold sheets. Trust with care. |
| `estimated` | Derived, interpolated, or read off a degraded source image. Directionally useful, numerically approximate. |
| `unverified` | Placeholder. Shaped correctly, numerically meaningless. |
| `deprecated` | Known wrong, kept for history, ignored by the engine. |

Three records are `estimated` specifically because the supplied chart images
were ambiguous, and each carries a note saying exactly what to re-check:

- **Post Fade Phenom** — Bronze asks for *more* Mid-Range than Silver (83 vs 71).
  Probably a misprint for 63. Recorded as printed; `data:validate` warns.
- **Pick Dodger** — the Bronze cell renders as Interior Defense + Strength while
  the rest of the ladder is Perimeter Defense + Agility. Recorded to match the
  ladder.
- **Wall Up** — the whole row is degraded in the image, the Strength values
  especially.
- **Post Lockdown** token costs — Gold/HOF render as 6/7, breaking the otherwise
  perfectly consistent 1/3/4/5 ladder every other Bronze-costs-1 badge follows.
  Recorded as 4/5.

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
Badges, their level ladder, the attribute thresholds for each level, and the
**badge token cost** of each tier.

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
