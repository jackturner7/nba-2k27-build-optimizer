# How the optimizer works

The goal is not "make every requested attribute as high as possible". It is
"spend each build point where it buys something", where *something* means a
badge level, an animation package, or a takeover tier.

## Why thresholds are the whole game

Badges, animations and takeovers unlock at discrete ratings. Between two
thresholds, a rating changes nothing you can feel — it only costs more. So if
89 Three-Point is the last rating that unlocks anything reachable, then 90 is
strictly worse than 89: same gameplay, fewer points left for everything else.

Every stage of the engine is built around that observation.

## The pipeline

```
body settings
   │
   ├─► computeCaps()      per-attribute maximums for this frame
   ├─► computeBudget()    total build points
   │
   ▼
collectBreakpoints()      every rating on every attribute that unlocks something
   │
   ▼
collectCommitments()      multi-attribute requirements worth forcing
   │
   ▼
buildFloorSets()          candidate "these combos are mandatory" starting points
   │
   ▼
solveKnapsack()   × profiles   exact multiple-choice knapsack over threshold levels
   │
   ▼
polish()                  trim above-threshold fat, re-spend on cheapest real gains
   │
   ▼
evaluateBuild()           badges, animations, takeovers, cap breakers, boosts, waste
   │
   ▼
pickDiverse() + tradeoffs
```

### 1. Breakpoints (`engine/breakpoints.ts`)

For each attribute, gather every rating that any badge tier, animation,
takeover tier, dependency rule or user-supplied constraint asks for, filtered to
what this body can actually reach. Add the rating floor ("spend nothing here")
and the cap ("nothing left to buy").

A 22-attribute build with 99 possible ratings each has an astronomically large
search space. After this step each attribute has roughly 5–15 candidate values,
and the space becomes searchable exactly rather than heuristically.

`lastUsefulBreakpoint(value)` — the highest threshold at or below a rating — is
the definition of waste used throughout the app.

### 2. Commitments and floor sets (`engine/optimize.ts`)

Requirements that name two or more attributes (Shifty Shooter needs 3PT *and*
Ball Handle; Elite Contact Dunks needs Driving Dunk *and* Vertical *and*
Strength) are not separable, so a straight knapsack undervalues them: partial
progress toward a conjunction is worth nothing.

They are handled as **commitments** — optional decisions to force a set of
minimums. The search builds several candidate floor sets:

- the user's own hard minimums alone,
- each high-value commitment individually,
- a greedy chain that stacks the best value-per-point commitments together.

Each floor set is then solved exactly. This is what stops the optimizer from
landing two points short of a badge it was always going to want.

### 3. The knapsack (`solveKnapsack`)

A multiple-choice knapsack: each attribute picks exactly one candidate level,
the total cost stays inside the budget, maximise value. Solved exactly with
dynamic programming over the budget.

The value function is a *separable surrogate*: per-attribute threshold gains
plus a small linear term so prioritised attributes still gain something between
thresholds. Multi-attribute requirements get partial credit here, unless the
floor set already guarantees the other half — in which case they are credited in
full, because at that point they really are a single-attribute decision.

Four weighting profiles run over the floor sets (balanced, badge-maximising,
point-efficient, rating-forward). They are what produces genuinely different
builds to compare rather than four versions of the same one.

### 4. Polish (`polish`)

The knapsack optimises a surrogate. This pass measures the *real* score and
alternates:

- **Trim** — pull every rating back to its last useful threshold if the real
  score does not drop.
- **Refill** — spend what that freed on the cheapest next threshold that
  actually improves the real score.

Repeats until nothing changes. This is where the last few points of slack get
squeezed out.

### 5. Scoring (`engine/score.ts`)

Nine components, each roughly 0–100:

| # | Component | What it measures |
| --- | --- | --- |
| 1 | Badge value | Σ level weight × badge impact, amplified for badges on attributes you prioritised |
| 2 | Animation unlocks | Best unlock per category counts fully, the rest are flavour; takeovers fold in here |
| 3 | Attribute efficiency | Share of spend that sits at or below a useful threshold |
| 4 | Defensive versatility | Sub-linear power mean across the five defensive attributes, so breadth beats one spike |
| 5 | Shooting | Weighted 3PT / mid-range / free throw |
| 6 | Finishing | Weighted dunk / layup / close shot / post |
| 7 | Playmaking | Weighted passing / handle / speed with ball |
| 8 | Physicals | Weighted speed / acceleration / vertical / strength / stamina |
| 9 | Wasted points | **Negative.** Build points sitting above the last useful threshold |

Components 4–8 are scaled by how much you actually asked for that area, so a
Stretch Big is not punished for having no Ball Handle. A floor of 0.15 keeps a
completely ignored category from being free to tank into unplayability.

Ratings are passed through `effectiveAttributes()` first, which applies the
declared dependency rules — a 95 Speed With Ball on a 60 Ball Handle build does
not score like a 95.

### 6. Cap breakers and badge boosts (`engine/plans.ts`)

Both are post-build overlays, planned after the build is fixed.

**Cap breakers** buy exactly one point each, so the only question worth asking
is which single point crosses a threshold. The planner only considers attributes
already sitting at their cap (anywhere else, ordinary build points are cheaper),
and greedily takes the placement with the largest unlock gain. Breakers with no
threshold to chase are reported as unplaced rather than dumped somewhere.

**Badge boosts** allocate the +2 slot first — a +2 on the wrong badge is the
most expensive mistake available — then the +1 slots, ranked by level-weight
gain × impact × how much you prioritised that badge's attributes.

### 7. Diversity and tradeoffs

Candidates are deduplicated by exact attribute vector, scored with *your*
weightings (not the search profile's, so the comparison is fair), and then
filtered so returned builds are actually different from each other. Each build
gets tradeoff notes naming the attributes where it differs from its nearest
rival, and a per-attribute rationale explaining what its rating unlocked and
what the next unlock would cost.

## Complexity and runtime

Roughly 14 floor sets × up to 4 profiles, each an O(attributes × budget ×
levels) DP, plus a memoised polish loop. Typical searches finish in 100–400 ms
on the placeholder dataset; the test suite asserts under 8 s as a regression
guard.

## Things the engine deliberately does not do

- **It will not invent a threshold.** If nothing in the data requires an
  attribute, the optimizer leaves it at the floor and the UI reports the
  coverage gap. See `docs/DATA.md`.
- **It will not quietly lower a hard minimum.** An impossible requirement is
  reported as infeasible, with the cap that makes it impossible and a suggestion
  of what to change. A best-effort build is still returned so you can see how
  close the frame gets.
- **It will not dump leftover points for show.** Unspent points are reported,
  with the next thresholds they could go toward.
