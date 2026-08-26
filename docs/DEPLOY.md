# Deploying

There are **two deployment modes**, and the app supports both from one codebase.

| | static | container |
| --- | --- | --- |
| Where the search runs | the visitor's browser, in a Web Worker | your server |
| Hosting | any static host — GitHub Pages, Netlify, S3 | any container host |
| Cost / ops | free, nothing to run | a process to keep alive |
| Saturation risk | none — a slow search costs only its own tab | shared CPU, hence the rate limiting and queue below |
| Updating data | rebuild | rebuild, or mount a volume and hit `/reload` |

They run **the same engine**. The core package's public entry has no node
builtins, so `optimize()` in the browser is not a reduced version of the server
one — it is the same code, gated by the same dataset.

**Static is the better fit for this app** and is what the Pages workflow
deploys. It is a read-only calculator with no accounts, no persistence and no
secrets; there is no reason to put a server in the path. The container mode
stays supported for anyone who wants an API to call from elsewhere.

## Static (GitHub Pages)

`.github/workflows/pages.yml` deploys on every push to `main`. It runs
`data:validate`, `data:crosscheck` and the tests first, so a malformed dataset
fails the deploy rather than shipping.

### One-time setup: enable Pages by hand

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

The workflow passes `enablement: true` to `actions/configure-pages`, which is
*supposed* to turn Pages on by itself. It does not work with the workflow's
default `GITHUB_TOKEN`: creating a Pages site is an admin-scoped operation, and
the first run fails with

```
Get Pages site failed.    Error: Not Found
Create Pages site failed. Error: Resource not accessible by integration
```

That is the failure to expect if you skip this step, and it happens *after* the
build succeeds, so a green validate/test/build is not evidence Pages is on. The
flag is kept because it is harmless once enabled and correct for anyone using a
PAT with admin scope.

**If the repository is private**, Pages also requires a paid plan (Pro, Team or
Enterprise). On a free account, either make the repository public or use another
static host — the build output is a plain directory, so Netlify, Cloudflare
Pages, S3 or any other will serve it unchanged.

### Where it lands

`https://<owner>.github.io/<repo>/`. `index.html` is copied to `404.html`
because Pages serves files rather than routes, and without it a refresh on a
deep link would 404.

### A trap when merging via an API token

Pushes made with a GitHub App or `GITHUB_TOKEN` **do not trigger workflows** —
GitHub suppresses them to prevent recursion. Merge a PR that way and neither CI
nor this deploy fires, with no error anywhere; the runs simply do not exist.
That is why the workflow also declares `workflow_dispatch`: trigger it manually
from the Actions tab, or with `gh workflow run pages.yml --ref main`. Merging
through the GitHub UI triggers it normally.

To build it yourself:

```bash
npm run build:static          # apps/web/dist, ready for any static host
BASE_PATH=/my-repo/ npm run build:static   # for a subpath
```

## Static (Cloudflare)

Worth doing for one reason: **the URL has no username in it.** A GitHub Pages
project site is always `https://<owner>.github.io/<repo>/` — the host is derived
from the account name and there is no setting that changes it.

Cloudflare has **two** products that will serve this, and the dashboard does not
make it obvious which one you are creating:

| | Workers (static assets) | Pages |
| --- | --- | --- |
| What "connect a repo" gives you now | this | you have to find the Pages tab |
| Deploy step | `npx wrangler deploy` | uploads the output directory |
| Needs `wrangler.jsonc` | **yes** | no |
| Reads `_redirects` / `_headers` | no | yes |
| URL | `<worker>.<account-subdomain>.workers.dev` | `<project>.pages.dev` |

Both are supported here. The repo carries config for each, because they cost
nothing when unused and the failure mode of guessing wrong is bad: **the build
stage goes green and the deploy stage fails**, which reads like a build problem
and is not one.

### Workers (what the dashboard gives you by default)

`wrangler.jsonc` in the repo root is what makes `npx wrangler deploy` work. It
declares an **assets-only Worker** — `assets` with no `main`, so no server code
runs and the deployment behaves exactly like the GitHub Pages one.

In the dashboard, the only field that needs changing from its default is the
build command:

| Field | Value |
| --- | --- |
| Build command | `npm run build:static:checked` |
| Deploy command | `npx wrangler deploy` (the default — leave it) |
| Root directory | `/` (the default — leave it) |

The default build command is `npm run build`, and it is **wrong here**: it omits
`VITE_STATIC`, so the app ships expecting an API to call and every search 404s
against a host that has no backend. It builds cleanly, so nothing fails — you
just get a broken page.

The output directory is not a dashboard field on this path; `wrangler.jsonc`
names it (`./apps/web/dist`).

**The URL includes your account's `workers.dev` subdomain**, which is not the
same as the worker name and may well be your username. It is set per account
under **Workers & Pages → Subdomain** and can be changed there.

### Pages

Gives `https://<project>.pages.dev/` with no account name anywhere, which is the
better URL if that is what you are after. **Workers & Pages → Create →** the
**Pages** tab **→ Connect to Git**, then three fields:

| Field | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build:static:checked` |
| Build output directory | `apps/web/dist` |

Framework preset *None*, root directory empty. The project name you type **is**
the subdomain, and it is globally unique across Cloudflare, so a plausible name
may be taken.

Pages ignores `wrangler.jsonc` as written here — a Workers config is not a Pages
config. If a Pages build ever complains about it, the fix is to give Pages its
own `pages_build_output_dir`, not to delete this one.

### Common to both

`BASE_PATH` is deliberately not set: Cloudflare serves from the root, and the
Vite config already defaults `base` to `/`. Setting it would break every asset.

`.node-version` in the repo root pins the build to Node 22. Without it
Cloudflare picks its own default, which has been old enough to fail the build.

### Why the build command is not just `build:static`

`build:static:checked` runs `data:validate`, `data:crosscheck` and the tests
first, then builds — the same gate `pages.yml` applies as separate steps and the
Dockerfile applies in its own build. **The dataset is the product**, so a
malformed cap table or an undocumented source conflict has to fail the deploy on
every path out of this repo, not just the one that happens to be a workflow.

### The two files in `apps/web/public/`

`_redirects` and `_headers` are read by **Cloudflare Pages** (and Netlify) and
ignored by GitHub Pages and by Workers.

- `_redirects` sends unmatched paths to `index.html` with a 200. Static hosts
  serve files rather than routes, so without it a refresh on a deep link 404s.
  Real files still take precedence, so `/assets/*` is unaffected.
- `_headers` caches `/assets/*` forever and `index.html` never. Vite fingerprints
  asset filenames, so a changed file is a changed URL — but only if the entry
  point that references them is re-fetched. Caching `index.html` would ship a
  deploy nobody is told to download.

Each host gets the SPA-fallback behaviour its own way, which is why it is
configured three times and not once:

| host | mechanism |
| --- | --- |
| GitHub Pages | `404.html`, a copy of `index.html` made in `pages.yml` |
| Cloudflare Pages | `_redirects` |
| Cloudflare Workers | `assets.not_found_handling` in `wrangler.jsonc` |

Only GitHub Pages returns a 404 *status* while doing it; the other two return
200. That difference is cosmetic for this app — it has no client-side router, so
there are no deep links to land on — but it is the reason not to treat the three
as interchangeable.

### Which one is canonical

Pick one and let the other be a mirror, or turn the other off — two live copies
of the same tool is mostly a way to confuse yourself about which one you last
deployed. Nothing in the repo assumes either.

## Container

The container mode is **one container**: an Express process that serves the JSON API
and the built React UI from the same port. There is no database, no cache, and
no external service — the dataset is JSON files baked into the image.

```bash
docker build -t 2k27-optimizer .
docker run -p 8080:8080 2k27-optimizer
# http://localhost:8080
```

That works unchanged on Fly, Render, Railway, Cloud Run, ECS, or a VPS with
Docker. `fly.toml` in the repo root is a working example for one of them; the
rest need nothing but the image and the environment variables below.

---

## What the build enforces

The Docker build runs `data:validate`, `data:crosscheck`, `typecheck`, `test`
and `build` before it will produce an image. That ordering is deliberate: **the
dataset is the product**, so a malformed cap table or an undocumented conflict
between two badge sources fails the build rather than shipping an app that
optimizes confidently against nonsense.

CI (`.github/workflows/ci.yml`) runs the same checks, then smoke-tests the
built server: health, the SPA index, and a real optimize call. It also builds
the image and curls it. A green unit-test run does not prove the thing you
deploy actually boots.

---

## Configuration

Everything is environment variables; none are required.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` in the image, `4000` otherwise | Listen port. |
| `NODE_ENV` | — | Set to `production` to get generic 500s and gate the reload endpoint. |
| `DATA_ROOT` | auto-discovered | Absolute path to a directory containing `<datasetId>/meta.json`. Point this at a mounted volume to update the dataset without rebuilding. |
| `WEB_DIST` | next to the data root | Where the built UI lives. |
| `DATASET_ID` | `2k27` | Which dataset to report at startup. |
| `RELOAD_TOKEN` | unset | Enables `POST /api/datasets/:id/reload` in production, requiring this value in an `x-reload-token` header. Unset means the endpoint is off. |
| `RATE_LIMIT_GENERAL` | `300` | Requests per minute per IP across `/api`. |
| `RATE_LIMIT_OPTIMIZE` | `30` | Requests per minute per IP for the four search routes. |
| `MAX_QUEUE_DEPTH` | `4` | How many searches may be waiting before further ones are refused. |
| `TRUST_PROXY_HOPS` | `1` | Proxy hops to trust when deriving the client IP. |
| `CORS_ORIGIN` | `*` | Comma-separated allowlist. |

### `TRUST_PROXY_HOPS` matters more than it looks

Rate limiting is per-IP. Behind a load balancer, every request appears to come
from the balancer unless the app is told how many hops to trust, and the whole
internet shares one bucket. The default of `1` is right for every managed
platform that puts a single proxy in front of you. Set it higher only if you
have added your own proxy in front of theirs — setting it too high lets a client
forge `X-Forwarded-For` and evade the limit entirely.

---

## How the app protects itself

The optimizer is **synchronous CPU work**: a search is 100–400 ms during which
the process does nothing else. That single fact drives the whole design.

**Per-IP rate limiting** is the first line: 30 searches/minute, against 300 for
the cheap lookup endpoints the UI hits while you drag a slider.

**A bounded queue** is the second, and it is the one that matters under a burst.
Admission is recorded synchronously and the search deferred by one
`setImmediate`, so a burst of arrivals all pass through admission before the
first search starts and the pending count is the *real* queue depth. Past
`MAX_QUEUE_DEPTH` the server returns `503` with `Retry-After` instead of
queueing — because a queued request would slow every *other* request down
rather than just its own, and the client cannot tell slow from hung.

The alternative was measuring event-loop lag, and it was tried first. It does
not work here, in both directions:

| approach | 40 concurrent searches | 12 sequential searches |
| --- | --- | --- |
| windowed mean lag | shed **0**, `/api/health` blocked **4.3 s** | fine |
| most-recent-sample lag | shed correctly | refused **3 of 12** — false positives |
| bounded queue (shipped) | shed 35, health worst **435 ms** | **12/12 admitted** |

Lag cannot distinguish "a search just finished" from "thirty more are queued".
Queue depth can. Lag is still measured and reported on `/api/health`, because it
is the right number to look at when a deployed instance feels slow.

**There is no request timeout, and there cannot be one.** You cannot interrupt
synchronous JavaScript. Refusing to start work is the only lever, which is why
admission control carries the weight here.

### Scaling

One instance ≈ 3–6 searches/second on one core. The process is stateless, so
scaling is horizontal: add instances behind the load balancer. Raise
`MAX_QUEUE_DEPTH` only if you have given the container more than one core, and
even then the ceiling is one search at a time per process — Node runs your
JavaScript on a single thread regardless of how many cores the box has. Running
several instances beats giving one instance more CPU.

---

## Health checks

`GET /api/health` returns liveness plus the numbers that distinguish a saturated
instance from a broken one:

```json
{
  "ok": true,
  "reloadEnabled": false,
  "load": { "pending": 0, "peakPending": 4, "admittedTotal": 17, "shedTotal": 35, "eventLoopLagMs": 1 },
  "uptimeSeconds": 812
}
```

A rising `shedTotal` means you need more instances, not a restart. Give the
check a **timeout of at least 2 s**: an in-flight search can delay the response
by its own duration, and that is normal, not a fault.

The process handles `SIGTERM` by closing the listener so in-flight requests
finish, with a 10 s backstop. Give the platform a grace period of at least that.

---

## Updating the dataset without redeploying

Two options.

1. **Mount a volume** and point `DATA_ROOT` at it. Then `POST
   /api/datasets/2k27/reload` with the `x-reload-token` header re-reads from
   disk. The UI's *Reload data* button hides itself when the server reports the
   endpoint is off, so it never offers an action that will 404.
2. **Rebuild the image.** Simpler, and the dataset is only 272 KB — the whole
   image is ~23 MB of `node_modules` plus dist and data.

Reload is *disabled by default in production*. It re-reads from disk and drops
the cache, which is exactly what you want while editing JSON locally and exactly
what you do not want exposed anonymously on the internet.

---

## Positioning

The UI carries a footer disclaiming affiliation with 2K, Visual Concepts,
Take-Two and the NBA, naming *NBA 2K27* and *MyPLAYER* as trademarks of their
owners, and noting that no game assets or code are redistributed. It also tells
visitors that several values are estimates and to check anything they are about
to spend VC on against the in-game builder.

That is the standard shape for a fan tool and it is deliberately quiet. Edit or
remove it in `apps/web/src/App.tsx` (`.site-footer`) if you want different
wording — but do that as a decision, not by accident.

The dataset banner covers the other half of not misleading anyone: which numbers
are sourced, which are invented, and that point costs are ordinal.
