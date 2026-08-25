# NBA 2K27 MyPLAYER Build Optimizer

A full-stack build optimizer for NBA 2K27 MyPLAYER. You describe the player you
want; it works out the most *efficient* attribute allocation within the
builder's restrictions — not simply the highest one.

> ## ⚠️ The dataset is PARTIALLY sourced — check the label on each number
>
> **Real 2K27 data:** every badge requirement and badge token cost for Shooting,
> Playmaking, Defense and Finishing; the animation and takeover thresholds from
> the community "best value attribute thresholds" sheet; the builder's attribute
> list; and the *direction* of each body setting's effect on caps.
>
> **Still invented:** attribute **caps** (magnitudes), **cost curves**, the
> **build point budget**, the badge **token-earning formula**, cap breaker
> counts, and badge boost slots.
>
> **Missing entirely:** the Rebounding and Physicals badge cost charts.
>
> Every record carries a `verification.status` and the UI shows it next to the
> value. `npm run data:report` tells you where you stand. See
> [`docs/DATA.md`](docs/DATA.md).

---

## The idea

Badges, animations and takeovers unlock at discrete ratings. Between two
thresholds a rating changes nothing you can feel — it only costs more. So if 89
Three-Point is the last rating that unlocks something reachable, 90 is strictly
worse: identical gameplay, fewer points left for everything else.

The optimizer is built entirely around that. It only ever considers ratings that
cross a threshold, then spends what it saves elsewhere, then reports anything
still sitting above the last useful threshold as waste you can recover.

**2K27 adds a second budget.** Badges are no longer granted automatically when
you hit a threshold — hitting it makes the badge *eligible*, and you then spend
**badge tokens** (earned per discipline by investing in that discipline) to
equip it, into a limited number of badge slots. A build is routinely eligible
for twice as many badges as it can afford. The engine models both budgets, and
scores the badges you can actually equip rather than the ones you merely
qualify for.

## What it does

- **2K-style body editor** — position, height, weight, wingspan, with legal
  ranges that re-derive as you move each slider, and live per-attribute caps.
- **Priority sliders** — 3PT shooting, perimeter defense, steal, driving dunk,
  ball handle, speed with ball, interior defense, block, rebounding,
  athleticism, and more. Priorities steer spending; they are not attribute
  targets.
- **Archetype presets** — 3-and-D Wing, Two-Way Shot Creator, Point Forward,
  Lockdown Defender, Stretch Big, Inside Center, Two-Way Guard, Slashing Wing.
- **Describe-a-build mode** — type
  *"6'8 wing with the highest three-point rating possible, elite perimeter
  defense, at least 85 steal, good driving dunk and enough ball handle for good
  dribble animations"* and get several optimized builds with the tradeoffs
  between them explained. Parsing is rule-based, and every clause it used is
  echoed back so you can see which phrase produced which constraint.
- **A nine-part optimization score** — badge value, animation unlocks, attribute
  efficiency, defensive versatility, shooting, finishing, playmaking, physicals,
  and wasted points.
- **Badge loadout and token planner** — which badges are eligible, which ones
  the token and slot budgets actually let you equip, what each costs, and which
  eligible badges got left behind and why. Type your real in-game token counts
  in to override the estimate.
- **Full unlock report** — next badge thresholds with the exact point cost to
  reach them, available and locked animations, takeover tiers, cap breaker
  recommendations, +1/+2 badge boost placement, and every point that may be
  wasted.
- **Per-attribute rationale** — why each rating stopped where it did, and what
  the next unlock would cost.

## Quick start

```bash
npm install
npm run build -w @2k27/core   # the web dev server aliases core's source, but the API needs the build
npm run dev                   # API on :4000, web on :5173
```

Or run them separately:

```bash
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:5173  (proxies /api to :4000)
```

For a single-process production build:

```bash
npm run build && npm start    # API serves the built UI on :4000
```

### Working on the data

```bash
npm run data:validate   # structural + cross-file checks; exits 1 on error
npm run data:report     # what is still placeholder, and which attributes nothing gates on
npm test                # engine invariants
npm run typecheck
```

The API reloads a dataset without restarting:
`POST /api/datasets/2k27/reload`, or the **Reload data** button in the UI banner.

## Architecture

```
data/2k27/          15 JSON files — all game knowledge lives here, nowhere else
packages/core/      engine: caps, costs, breakpoints, knapsack, scoring, NL parsing
apps/api/           Express: dataset serving, optimize, evaluate, describe
apps/web/           React + Vite builder UI
docs/               DATA.md (replacing the data), OPTIMIZER.md (how it works)
```

`@2k27/core` is isomorphic — the browser runs the same engine the server does,
which is why slider feedback is instant while the heavier search runs on the
API. The node-only dataset loader is a separate entry point (`@2k27/core/node`).

No game value is hard-coded anywhere in the application code. Replacing a JSON
file changes the app's behaviour with no code change.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Status and available datasets |
| `GET` | `/api/datasets/:id` | Full dataset, validation issues, verification and coverage reports |
| `POST` | `/api/datasets/:id/reload` | Re-read from disk |
| `GET` | `/api/datasets/:id/body-options` | Legal height/weight/wingspan ranges |
| `GET` | `/api/datasets/:id/caps` | Caps and budget for one body |
| `GET` | `/api/datasets/:id/breakpoints` | What each rating on each attribute unlocks |
| `POST` | `/api/datasets/:id/optimize` | Run the optimizer |
| `POST` | `/api/datasets/:id/evaluate` | Report on one specific build |
| `POST` | `/api/datasets/:id/archetype/:archetypeId/optimize` | Optimize from a preset |
| `POST` | `/api/datasets/:id/describe` | Natural-language mode |

## Known limitations

- **Caps, cost curves and the budget are still invented.** Builds will pick the
  right thresholds but may be affordable when they should not be. This is the
  most valuable thing left to replace — the NBA 2K HQ app's builder is the place
  to read exact caps off and paste them into `caps.json` → `overrides.entries`.
- **The token-earning formula is a guess.** Only the direction is sourced. It is
  currently calibrated so badge *slots* are the binding constraint, which is what
  "20 badge slots" being the headline number implies. Type your real per-
  discipline token counts into the UI to plan against those instead.
- **No Rebounding or Physicals badge charts.** Those badges have no token cost,
  so they cannot be equipped, and the app lists them as unpriced rather than
  assuming they are free.
- **Four rows need re-checking against the source.** Post Fade Phenom's Bronze
  Mid-Range requirement reads *higher* than its Silver; Pick Dodger's Bronze cell
  names different attributes from the rest of its ladder; Wall Up's row is badly
  degraded; Post Lockdown's Gold/HOF token costs break the otherwise perfect
  cost ladder. All four are marked `estimated` with a note, and `data:validate`
  warns about the first.
- **Attributes nothing gates on stay at the floor.** The engine only buys points
  that cross a threshold, so an attribute with no badge, animation or takeover
  requirement is worth nothing to it. Free Throw has zero requirements in any
  supplied chart, so it sits at 25. That is the data being incomplete, not the
  optimizer misbehaving — the app reports the gap rather than inventing a
  threshold.
- **`badge.impact` and the dependency rules are judgement, not game data.** They
  are labelled as modelling choices and are meant to be tuned by hand.
