# NBA 2K27 MyPLAYER Build Optimizer

A full-stack build optimizer for NBA 2K27 MyPLAYER. You describe the player you
want; it works out the most *efficient* attribute allocation within the
builder's restrictions — not simply the highest one.

> ## ⚠️ The dataset is PARTIALLY sourced — check the label on each number
>
> **Official 2K mechanics** (from [2K's MyPLAYER Builder page](https://nba.2k.com/2k27/features/myplayer-builder/)):
> 53 badges, 20 badge slots across six disciplines, badge tokens earned by
> playing, token cost varying by size and position, Legend reachable only through
> Synergy, 16 Synergy slots (12 × +1, 4 × +2), a Fused badge refunding its tokens,
> 5 Takeover slots / 24 abilities, and the 99-OVR cap breaker preview.
>
> **Real 2K27 data:** all 53 badges — requirements, AND/OR logic and per-badge
> **height ranges** — imported from [NBA 2K Lab](https://www.nba2klab.com/badge-requirements)
> and **corroborated against a second independent chart**, which agrees on 211 of
> 212 tiers and height gates (`npm run data:crosscheck`);
> badge **token costs** for 42 of them from the 2K27 badge cost charts; animation
> and takeover thresholds; the attribute list; the 5'9"–7'4" builder height
> range; and the *direction* of each body setting's effect on caps.
>
> **Read off the real builder** (NBA 2K HQ app): three builds — *Bucket Chaser*
> (PF 6'11"), *2-Way Playmaking Creator* (SG 6'8") and *2-Way Off-Screen Shooter*
> (SG 6'5") — with their full **cap breaker tables**. Those yield **35 proven
> attribute caps** and 28 lower bounds, established two independent ways that
> **agree where they overlap**: the slider screen's `current / MAX` figure, and a
> cap breaker ladder ending in a padlock (which means it hit the ceiling). The
> builder's "Original Cap" column is *not* a cap — it is what the player
> allocated. Scored against those 35, the linear model is **6.3 points off** and
> reads high on 24 of them; it was not refit, so every other frame carries that
> error and the UI says so per frame.
>
> **The build budget is the wrong shape, and we know it.** 2K27 has no point
> pool — the builder says *"Fill to a 99 Overall to Continue"*, so the real cost
> of an attribute point is its weight in the per-position OVR formula. Those
> weights are unpublished, so an invented pool stands in. **Every "costs N points"
> figure in this app is ordinal, not cardinal.**
>
> **Still invented:** attribute **cap magnitudes on untranscribed frames**, **cost
> curves**, the **build point budget**, the badge **token-earning formula**, the
> per-discipline **slot split**, **how many cap breakers** a player may claim, and
> badge boost slots.
>
> **Inferred:** token costs for the 11 Rebounding/Physicals badges, whose cost
> charts were never supplied. Flagged as estimated everywhere they are used.
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
**badge tokens** to equip it into one of 20 badge slots. A build is routinely
eligible for twice as many badges as it can afford. The engine models both
budgets and scores the badges you can actually equip, not the ones you merely
qualify for.

Tokens are earned by **playing** — discipline meters, practice drills, Gatorade
workouts — so how many you have is a fact about your account, not your build.
Set your real counts in the UI and the optimizer plans against those.

**Synergy** is the third lever: 16 slots (12 × +1, 4 × +2) that push a badge a
tier or two beyond what your attributes earned, and it is the *only* route to
Legend. A Fused badge also refunds the tokens that equipped it, so Synergy buys
back slot budget as well as tiers.

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
- **Height-gate awareness** — 25 of the 53 2K27 badges are restricted to a height
  band, so height locks badges out entirely rather than just moving caps. The app
  lists exactly which badges a body can never hold.
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

## Deploying

Two modes, one codebase, **the same engine in both** — the core package's public
entry has no node builtins, so `optimize()` runs unchanged in a browser.

**Static** (what the Pages workflow deploys, and the better fit): the optimizer
is compiled into the bundle and runs in a Web Worker, so there is no backend at
all. Free to host, nothing to keep alive, and no shared CPU to saturate. Pages
needs enabling once by hand — see [`docs/DEPLOY.md`](docs/DEPLOY.md).

```bash
npm run build:static   # apps/web/dist — drop on any static host
```

**Container**, if you want an API to call from elsewhere:

```bash
docker build -t 2k27-optimizer .
docker run -p 8080:8080 2k27-optimizer
```

The image build runs `data:validate`, `data:crosscheck`, `typecheck`, `test` and
`build` before it will produce anything, so a malformed cap table fails the build
rather than shipping an app that optimizes against nonsense. CI runs the same
checks and then smoke-tests the built server and the image.

Everything is optional environment variables, and the app defends itself against
the one thing that can hurt it — a burst of searches, which are synchronous CPU
work — with per-IP rate limiting plus a bounded queue that refuses rather than
queues. See [`docs/DEPLOY.md`](docs/DEPLOY.md), including why event-loop lag
turned out to be the wrong signal for that and queue depth is the right one.

### Working on the data

```bash
npm run data:validate   # structural + cross-file checks; exits 1 on error
npm run data:report     # what is still placeholder, and which attributes nothing gates on
npm test                # engine invariants
npm run typecheck

npm run data:crosscheck # diff the dataset against every independent source

node scripts/import-2klab.mjs           # re-import badge data from NBA 2K Lab
node scripts/import-2klab.mjs page.html # ...or from a saved copy of the page
```

The importer preserves badge token costs (2K Lab does not publish those) and
leaves anything it cannot source explicitly `null` rather than guessing.

`data:crosscheck` compares the shipped dataset against each file in
`data/2k27/sources/` and **fails if a disagreement is not recorded with a note**.
Sources can differ — but the app has to say so rather than quietly pick a winner.

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

- **Caps are proven on three frames, and only partly even there.** 35 attribute
  caps are proven; 28 more are known only as lower bounds; every other frame uses
  a linear model measured 6.3 points off and biased high. The derivation is
  documented in [`docs/DATA.md`](docs/DATA.md), and it is *not* a matter of
  copying the attribute page.
- **The budget is modelled as a point pool; the game uses a 99-OVR target.** The
  per-position OVR weights are unpublished, so point costs are a ranking rather
  than a quantity. This is now the weakest part of the dataset.
- **How many cap breakers you get is unknown.** The per-slot *gains* are read
  straight off the builder and are exact. The app assumes a shared pool of five
  across all attributes, which is the conservative of the two readings the
  builder's display supports.
- **Cost curves and the budget are still invented**, and are calibrated jointly
  with each other rather than against the game.
- **The size of your token pool is a guess**, because it depends on how much you
  have played. The default is calibrated so badge *slots* bind rather than
  tokens. Type your real per-discipline counts into the UI to plan against those.
- **Badge token costs are a single-body snapshot.** 2K states cost varies with
  size and position; the charts do not say which body they were captured at.
  `badge-tokens.json` → `costByBody` has the hook, defaulted to no adjustment.
- **15 of the 19 unlockable Takeover Abilities are missing**, so the optimizer
  under-values attributes whose only payoff is a takeover it cannot see.
- **Rebounding and Physicals token costs are estimated.** Their requirements are
  real; their prices come from the pattern the 42 priced badges follow. Turn the
  fallback off in `badge-tokens.json` to make them unequippable instead.
- **Attributes nothing gates on stay at the floor.** The engine only buys points
  that cross a threshold, so an attribute with no badge, animation or takeover
  requirement is worth nothing to it. Free Throw has zero requirements anywhere
  in the sourced data, so it sits at 25. That is the data being incomplete, not
  the optimizer misbehaving — the app reports the gap rather than inventing a
  threshold.
- **`badge.impact` and the dependency rules are judgement, not game data.** They
  are labelled as modelling choices and are meant to be tuned by hand.
